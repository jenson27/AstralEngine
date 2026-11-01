import assert from "node:assert/strict";
import test from "node:test";
import { AssetCatalog } from "../src/core/assets/asset-catalog.js";
import { AssetLoaderRegistry } from "../src/core/assets/asset-loader-registry.js";
import { AssetManager } from "../src/core/assets/asset-manager.js";
import { AssetScope } from "../src/core/assets/asset-scope.js";

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

test("deduplicates repeated acquisitions within one scope", async () => {
    const asset = { name: "cube" };
    let loadCount = 0;
    let releaseCount = 0;
    const assetManager = CreateAssetManager({
        Load() {
            loadCount += 1;
            return asset;
        },
        Release() {
            releaseCount += 1;
        },
    });
    const scope = new AssetScope(assetManager);

    const [firstAsset, secondAsset] = await Promise.all([
        scope.Acquire("mesh:cube"),
        scope.Acquire("mesh:cube"),
    ]);

    assert.strictEqual(firstAsset, asset);
    assert.strictEqual(secondAsset, asset);
    assert.strictEqual(scope.GetRequired("mesh:cube"), asset);
    assert.equal(loadCount, 1);

    await scope.ReleaseAll();

    assert.equal(releaseCount, 1);
});

test("exposes a stable handle while the scope holds the asset", async () => {
    const asset = { name: "cube" };
    const assetManager = CreateAssetManager({
        Load() {
            return asset;
        },
    });
    const scope = new AssetScope(assetManager);

    await scope.Acquire("mesh:cube");

    const handle = scope.GetHandleRequired("mesh:cube");

    assert.equal(handle.AssetId, "mesh:cube");
    assert.equal(handle.Version, 1);
    assert.strictEqual(handle.Current, asset);
    assert.strictEqual(scope.GetHandle("mesh:cube"), handle);

    await scope.ReleaseAll();

    assert.throws(
        () => handle.Current,
        /not currently loaded/,
    );
});

test("keeps an asset loaded until all scopes release it", async () => {
    let loadCount = 0;
    let releaseCount = 0;
    const assetManager = CreateAssetManager({
        Load() {
            loadCount += 1;
            return { name: "cube" };
        },
        Release() {
            releaseCount += 1;
        },
    });
    const firstScope = new AssetScope(assetManager);
    const secondScope = new AssetScope(assetManager);

    const [firstAsset, secondAsset] = await Promise.all([
        firstScope.Acquire("mesh:cube"),
        secondScope.Acquire("mesh:cube"),
    ]);

    assert.strictEqual(firstAsset, secondAsset);
    assert.equal(loadCount, 1);

    await firstScope.ReleaseAll();

    assert.equal(releaseCount, 0);
    assert.equal(assetManager.GetState("mesh:cube"), "loaded");

    await secondScope.ReleaseAll();

    assert.equal(releaseCount, 1);
    assert.equal(assetManager.GetState("mesh:cube"), "unloaded");
});

test("releases an asset when its pending acquisition finishes after scope closure", async () => {
    let completeLoad;
    let signalLoadStarted;
    let releaseCount = 0;
    const loadStarted = new Promise((resolve) => {
        signalLoadStarted = resolve;
    });
    const assetManager = CreateAssetManager({
        Load() {
            signalLoadStarted();
            return new Promise((resolve) => {
                completeLoad = resolve;
            });
        },
        Release() {
            releaseCount += 1;
        },
    });
    const scope = new AssetScope(assetManager);

    const acquisition = scope.Acquire("mesh:cube");
    const releaseAll = scope.ReleaseAll();

    await loadStarted;
    completeLoad({ name: "cube" });

    await assert.rejects(
        acquisition,
        /Asset scope closed while acquiring/,
    );
    await releaseAll;

    assert.equal(releaseCount, 1);
    assert.equal(assetManager.GetState("mesh:cube"), "unloaded");
});

test("ReleaseAll is safe to call more than once", async () => {
    let releaseCount = 0;
    const assetManager = CreateAssetManager({
        Load() {
            return { name: "cube" };
        },
        Release() {
            releaseCount += 1;
        },
    });
    const scope = new AssetScope(assetManager);

    await scope.Acquire("mesh:cube");

    const firstRelease = scope.ReleaseAll();
    const secondRelease = scope.ReleaseAll();

    assert.strictEqual(firstRelease, secondRelease);

    await Promise.all([firstRelease, secondRelease]);
    await scope.ReleaseAll();

    assert.equal(releaseCount, 1);
});
