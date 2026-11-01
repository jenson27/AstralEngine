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

test("stages a dependency and its loaded dependents as one reload", async () => {
    const textures = [];
    const releases = [];
    let materialVersion = 0;
    const manager = CreateAssetManager(
        [
            CreateDescriptor("texture:stone"),
            CreateDescriptor("material:stone", ["texture:stone"]),
        ],
        {
            "loader:texture:stone": {
                Load() {
                    const texture = { version: textures.length + 1 };
                    textures.push(texture);
                    return texture;
                },
                Release(texture) {
                    releases.push(["texture", texture.version]);
                },
            },
            "loader:material:stone": {
                Load(_descriptor, { GetDependency }) {
                    return {
                        version: ++materialVersion,
                        texture: GetDependency("texture:stone"),
                    };
                },
                Release(material) {
                    releases.push(["material", material.version]);
                },
            },
        },
    );

    const textureLease = await manager.Acquire("texture:stone");
    const materialLease = await manager.Acquire("material:stone");
    const textureHandle = textureLease.Handle;
    const materialHandle = materialLease.Handle;
    const firstTexture = textureHandle.Current;
    const firstMaterial = materialHandle.Current;

    const staged = await manager.StageReload("texture:stone");

    assert.deepEqual(staged.affectedAssetIds, [
        "texture:stone",
        "material:stone",
    ]);
    assert.strictEqual(textureHandle.Current, firstTexture);
    assert.strictEqual(materialHandle.Current, firstMaterial);

    const cleanupPromise = manager.CommitStagedReload();

    assert.strictEqual(textureHandle.Current, textures[1]);
    assert.strictEqual(materialHandle.Current.texture, textures[1]);
    assert.equal(textureHandle.Version, 2);
    assert.equal(materialHandle.Version, 2);

    await cleanupPromise;

    assert.deepEqual(releases, [
        ["material", 1],
        ["texture", 1],
    ]);

    await materialLease.Release();
    await textureLease.Release();
});

test("keeps live dependencies when a dependent reload fails", async () => {
    const textures = [];
    const releasedTextures = [];
    let materialLoadCount = 0;
    const manager = CreateAssetManager(
        [
            CreateDescriptor("texture:stone"),
            CreateDescriptor("material:stone", ["texture:stone"]),
        ],
        {
            "loader:texture:stone": {
                Load() {
                    const texture = { version: textures.length + 1 };
                    textures.push(texture);
                    return texture;
                },
                Release(texture) {
                    releasedTextures.push(texture);
                },
            },
            "loader:material:stone": {
                Load(_descriptor, { GetDependency }) {
                    materialLoadCount += 1;

                    if (materialLoadCount === 2) {
                        throw new Error("Invalid updated material.");
                    }

                    return {
                        texture: GetDependency("texture:stone"),
                    };
                },
            },
        },
    );

    const textureLease = await manager.Acquire("texture:stone");
    const materialLease = await manager.Acquire("material:stone");
    const originalTexture = textureLease.Handle.Current;
    const originalMaterial = materialLease.Handle.Current;

    await assert.rejects(
        manager.StageReload("texture:stone"),
        /Failed to stage reload for texture:stone/,
    );

    assert.strictEqual(textureLease.Handle.Current, originalTexture);
    assert.strictEqual(materialLease.Handle.Current, originalMaterial);
    assert.equal(textureLease.Handle.Version, 1);
    assert.equal(materialLease.Handle.Version, 1);
    assert.deepEqual(releasedTextures, [textures[1]]);
    assert.equal(manager.GetState("texture:stone"), "loaded");
    assert.equal(manager.GetState("material:stone"), "loaded");

    await materialLease.Release();
    await textureLease.Release();
});
