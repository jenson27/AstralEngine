import assert from "node:assert/strict";
import test from "node:test";
import { AssetCatalog } from "../src/core/assets/asset-catalog.js";
import { AssetLoaderRegistry } from "../src/core/assets/asset-loader-registry.js";
import { AssetManager } from "../src/core/assets/asset-manager.js";

function CreateAssetManager(loader) {
    const assetCatalog = new AssetCatalog();
    assetCatalog.Register({
        id: "mesh:cube",
        typeId: "mesh",
        loaderId: "test:mesh",
        source: { kind: "test" },
        version: 1,
    });

    const loaderRegistry = new AssetLoaderRegistry();
    loaderRegistry.Register("test:mesh", loader);

    return new AssetManager(assetCatalog, loaderRegistry);
}

test("shares one load between concurrent acquisitions", async () => {
    const asset = { name: "cube" };
    let loadCount = 0;
    const manager = CreateAssetManager({
        Load() {
            loadCount += 1;
            return asset;
        },
    });

    const leases = await Promise.all([
        manager.Acquire("mesh:cube"),
        manager.Acquire("mesh:cube"),
    ]);

    assert.equal(loadCount, 1);
    assert.strictEqual(leases[0].Asset, asset);
    assert.strictEqual(leases[1].Asset, asset);

    await Promise.all(leases.map((lease) => lease.Release()));
});

test("stages an asset replacement and swaps its stable handle on commit", async () => {
    const assets = [{ version: 1 }, { version: 2 }];
    const releasedAssets = [];
    let loadCount = 0;
    const manager = CreateAssetManager({
        Load() {
            return assets[loadCount++];
        },
        Release(asset) {
            releasedAssets.push(asset);
        },
    });

    const lease = await manager.Acquire("mesh:cube");
    const handle = lease.Handle;

    const staged = await manager.StageReload("mesh:cube");

    assert.deepEqual(staged.affectedAssetIds, ["mesh:cube"]);
    assert.strictEqual(handle.Current, assets[0]);
    assert.equal(handle.Version, 1);
    assert.deepEqual(releasedAssets, []);

    let nextLeaseReady = false;
    const nextLeasePromise = manager
        .Acquire("mesh:cube")
        .then((nextLease) => {
            nextLeaseReady = true;
            return nextLease;
        });

    await Promise.resolve();
    assert.equal(nextLeaseReady, false);

    const cleanupPromise = manager.CommitStagedReload();

    assert.ok(cleanupPromise instanceof Promise);
    assert.strictEqual(handle.Current, assets[1]);
    assert.equal(handle.Version, 2);

    const nextLease = await nextLeasePromise;
    assert.strictEqual(nextLease.Handle, handle);
    assert.strictEqual(nextLease.Asset, assets[1]);

    await cleanupPromise;
    assert.deepEqual(releasedAssets, [assets[0]]);

    await nextLease.Release();
    await lease.Release();
    assert.deepEqual(releasedAssets, [assets[0], assets[1]]);
});

test("releases the asset after its final lease is released", async () => {
    let releaseCount = 0;
    const manager = CreateAssetManager({
        Load() {
            return { name: "cube" };
        },
        Release() {
            releaseCount += 1;
        },
    });

    const firstLease = await manager.Acquire("mesh:cube");
    const secondLease = await manager.Acquire("mesh:cube");

    await firstLease.Release();

    assert.equal(releaseCount, 0);
    assert.equal(manager.GetState("mesh:cube"), "loaded");

    await secondLease.Release();

    assert.equal(releaseCount, 1);
    assert.equal(manager.GetState("mesh:cube"), "unloaded");
});

test("releasing the same lease twice releases the asset only once", async () => {
    let releaseCount = 0;
    const manager = CreateAssetManager({
        Load() {
            return { name: "cube" };
        },
        Release() {
            releaseCount += 1;
        },
    });

    const lease = await manager.Acquire("mesh:cube");

    await lease.Release();
    await lease.Release();

    assert.equal(releaseCount, 1);
    assert.equal(manager.GetState("mesh:cube"), "unloaded");
});

test("allows an asset load to be retried after failure", async () => {
    let loadCount = 0;
    const asset = { name: "cube" };
    const manager = CreateAssetManager({
        Load() {
            loadCount += 1;

            if (loadCount === 1) {
                throw new Error("Temporary load failure.");
            }

            return asset;
        },
    });

    await assert.rejects(
        manager.Acquire("mesh:cube"),
        /Failed to load asset "mesh:cube"/,
    );

    assert.equal(manager.GetState("mesh:cube"), "failed");

    const lease = await manager.Acquire("mesh:cube");

    assert.equal(loadCount, 2);
    assert.strictEqual(lease.Asset, asset);
    assert.equal(manager.GetState("mesh:cube"), "loaded");

    await lease.Release();
});
