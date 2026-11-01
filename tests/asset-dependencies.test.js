import assert from "node:assert/strict";
import test from "node:test";
import { AssetCatalog } from "../src/core/assets/asset-catalog.js";
import { AssetLoaderRegistry } from "../src/core/assets/asset-loader-registry.js";
import { AssetManager } from "../src/core/assets/asset-manager.js";

function CreateDescriptor(id, dependencies = []) {
    return {
        id,
        typeId: "test",
        loaderId: `loader:${id}`,
        source: { kind: "test" },
        version: 1,
        dependencies,
    };
}

function CreateAssetManager(descriptors, loaders) {
    const assetCatalog = new AssetCatalog();

    for (const descriptor of descriptors) {
        assetCatalog.Register(descriptor);
    }

    const loaderRegistry = new AssetLoaderRegistry();

    for (const [loaderId, loader] of Object.entries(loaders)) {
        loaderRegistry.Register(loaderId, loader);
    }

    return new AssetManager(assetCatalog, loaderRegistry);
}

test("shares dependency loads and releases them after their parents", async () => {
    const sharedTexture = { name: "shared texture" };
    let textureLoadCount = 0;
    let textureReleaseCount = 0;

    const manager = CreateAssetManager(
        [
            CreateDescriptor("texture:shared"),
            CreateDescriptor("material:first", ["texture:shared"]),
            CreateDescriptor("material:second", ["texture:shared"]),
        ],
        {
            "loader:texture:shared": {
                Load() {
                    textureLoadCount += 1;
                    return sharedTexture;
                },
                Release() {
                    textureReleaseCount += 1;
                },
            },
            "loader:material:first": {
                Load(_descriptor, { GetDependency }) {
                    return {
                        texture: GetDependency("texture:shared"),
                    };
                },
            },
            "loader:material:second": {
                Load(_descriptor, { GetDependency }) {
                    return {
                        texture: GetDependency("texture:shared"),
                    };
                },
            },
        },
    );

    const [firstMaterial, secondMaterial] = await Promise.all([
        manager.Acquire("material:first"),
        manager.Acquire("material:second"),
    ]);

    assert.equal(textureLoadCount, 1);
    assert.strictEqual(firstMaterial.Asset.texture, sharedTexture);
    assert.strictEqual(secondMaterial.Asset.texture, sharedTexture);

    await firstMaterial.Release();

    assert.equal(textureReleaseCount, 0);
    assert.equal(manager.GetState("texture:shared"), "loaded");

    await secondMaterial.Release();

    assert.equal(textureReleaseCount, 1);
    assert.equal(manager.GetState("texture:shared"), "unloaded");
});

test("releases dependencies when a parent asset fails to load", async () => {
    let textureReleaseCount = 0;

    const manager = CreateAssetManager(
        [
            CreateDescriptor("texture:stone"),
            CreateDescriptor("material:broken", ["texture:stone"]),
        ],
        {
            "loader:texture:stone": {
                Load() {
                    return { name: "stone texture" };
                },
                Release() {
                    textureReleaseCount += 1;
                },
            },
            "loader:material:broken": {
                Load() {
                    throw new Error("Invalid material data.");
                },
            },
        },
    );

    await assert.rejects(
        manager.Acquire("material:broken"),
        /Failed to load asset "material:broken"/,
    );

    assert.equal(textureReleaseCount, 1);
    assert.equal(manager.GetState("texture:stone"), "unloaded");
    assert.equal(manager.GetState("material:broken"), "failed");
});

test("detects dependency cycles before calling any loader", async () => {
    let loadCount = 0;

    const manager = CreateAssetManager(
        [
            CreateDescriptor("asset:first", ["asset:second"]),
            CreateDescriptor("asset:second", ["asset:first"]),
        ],
        {
            "loader:asset:first": {
                Load() {
                    loadCount += 1;
                    return {};
                },
            },
            "loader:asset:second": {
                Load() {
                    loadCount += 1;
                    return {};
                },
            },
        },
    );

    await assert.rejects(
        manager.Acquire("asset:first"),
        /Asset dependency cycle detected/,
    );

    assert.equal(loadCount, 0);
    assert.equal(manager.GetState("asset:first"), "unloaded");
});
