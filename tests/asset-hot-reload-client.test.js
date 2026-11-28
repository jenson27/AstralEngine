import assert from "node:assert/strict";
import test from "node:test";
import { CreateSceneComponentRegistry } from "../src/components/register-scene-components.js";
import { AssetCatalog } from "../src/core/assets/asset-catalog.js";
import { AssetLoaderRegistry } from "../src/core/assets/asset-loader-registry.js";
import { AssetManager } from "../src/core/assets/asset-manager.js";
import { HotReloadClient } from "../src/core/hot-reload-client.js";
import { SceneLoader } from "../src/core/scene/scene-loader.js";
import { SceneManager } from "../src/core/scene/scene-manager.js";

const sceneUrl = "/assets/scenes/main.scene.json";

class FakeEventSource {
    constructor(url) {
        this.url = url;
        this.closeCount = 0;
        this.listeners = new Map();
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    Emit(type, data = {}) {
        for (const listener of this.listeners.get(type) ?? []) {
            listener(data);
        }
    }

    close() {
        this.closeCount += 1;
    }
}

function CreateLogger() {
    return { Error() {}, Info() {}, Warn() {} };
}

function CreateManifest(assetIds = ["texture:first", "texture:second"]) {
    return {
        format: "astral-assets",
        version: 1,
        assets: assetIds.map((id) => ({
            id,
            typeId: "texture",
            loaderId: "image:texture",
            source: {
                kind: "image",
                url: `/assets/textures/${id.split(":")[1]}.png`,
            },
            version: 1,
        })),
    };
}

function CreateSceneDocument(name = "main") {
    return {
        format: "astral-scene",
        version: 1,
        name,
        activeCameraEntityId: "00000000-0000-4000-8000-000000000001",
        entities: [{
            id: "00000000-0000-4000-8000-000000000001",
            name: "Main Camera",
            components: [
                { typeId: "transform", version: 1, data: {
                    position: [0, 0, 3], rotation: [0, 0, 0], scale: [1, 1, 1],
                } },
                { typeId: "camera", version: 1, data: {
                    projectionType: "perspective",
                    fieldOfView: Math.PI / 3,
                    nearPlane: 0.1,
                    farPlane: 100,
                    orthographicSize: 5,
                } },
            ],
        }],
    };
}

function WaitForTurn() {
    return new Promise((resolve) => setImmediate(resolve));
}

async function WaitUntil(predicate) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        if (predicate()) {
            return;
        }
        await WaitForTurn();
    }
    assert.fail("Expected asynchronous engine state was not reached.");
}

async function CommitWhenReady(client) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        if (client.CommitAtFrameBoundary()) {
            return;
        }
        await WaitForTurn();
    }
    assert.fail("The staged asset reload did not become ready to commit.");
}

async function FlushTurns() {
    for (let turn = 0; turn < 5; turn += 1) {
        await WaitForTurn();
    }
}

function CreateAssetRuntime(manifest = CreateManifest(), loadAsset) {
    const catalog = new AssetCatalog();
    catalog.RegisterManifest(manifest);
    const loaderRegistry = new AssetLoaderRegistry();
    let generation = 0;
    loaderRegistry.Register("image:texture", {
        async Load(descriptor) {
            if (loadAsset) {
                return loadAsset(descriptor);
            }
            generation += 1;
            return { generation, sourceUrl: descriptor.source.url };
        },
        Release() {},
    });
    return {
        catalog,
        loaderRegistry,
        manager: new AssetManager(catalog, loaderRegistry),
    };
}

async function CreateHarness({
    sceneDocument = CreateSceneDocument(),
    manifest = CreateManifest(),
    loadAsset,
    fetchManifest = async () => manifest,
} = {}) {
    let currentDocument = sceneDocument;
    let sceneFetchCount = 0;
    let source;
    const assetRuntime = CreateAssetRuntime(manifest, loadAsset);
    const sceneLoader = new SceneLoader(
        CreateSceneComponentRegistry(),
        async (url) => {
            sceneFetchCount += 1;
            if (url !== sceneUrl) {
                return { ok: false, status: 404, text: async () => "" };
            }
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify(currentDocument),
            };
        },
    );
    const sceneManager = new SceneManager(sceneLoader);
    await sceneManager.LoadScene(sceneUrl);
    const client = new HotReloadClient(assetRuntime, sceneManager, {
        EventSourceClass: class extends FakeEventSource {
            constructor(url) {
                super(url);
                source = this;
            }
        },
        fetchFunction: async (url, options) => ({
            ok: true,
            status: 200,
            json: async () => fetchManifest(url, options),
        }),
        logger: CreateLogger(),
    });
    client.Connect();
    return {
        assetRuntime,
        client,
        get sceneFetchCount() { return sceneFetchCount; },
        get source() { return source; },
        set sceneDocument(value) { currentDocument = value; },
        sceneManager,
    };
}

test("commits queued asset changes through the real asset manager", async () => {
    const harness = await CreateHarness();
    const firstLease = await harness.assetRuntime.manager.Acquire("texture:first");
    const secondLease = await harness.assetRuntime.manager.Acquire("texture:second");
    const firstHandle = firstLease.Handle;
    const secondHandle = secondLease.Handle;
    const initialFirstVersion = firstHandle.Version;
    const initialSecondVersion = secondHandle.Version;

    harness.source.Emit("asset-change", {
        data: JSON.stringify({ paths: ["/assets/textures/first.png"] }),
    });
    harness.source.Emit("asset-change", {
        data: JSON.stringify({ paths: ["/assets/textures/second.png"] }),
    });
    await CommitWhenReady(harness.client);
    await WaitUntil(() => firstHandle.Version === initialFirstVersion + 1);
    await CommitWhenReady(harness.client);
    await WaitUntil(() => secondHandle.Version === initialSecondVersion + 1);

    assert.equal(firstHandle.Current.sourceUrl, "/assets/textures/first.png");
    assert.equal(secondHandle.Current.sourceUrl, "/assets/textures/second.png");
    harness.client.Dispose();
    await firstLease.Release();
    await secondLease.Release();
    await harness.sceneManager.Dispose();
});

test("stages a source change received while an asset is loading", async () => {
    let finishLoad;
    let loadCount = 0;
    const harness = await CreateHarness({
        loadAsset: () => {
            loadCount += 1;
            return loadCount === 1
                ? new Promise((resolve) => { finishLoad = resolve; })
                : Promise.resolve({ generation: loadCount });
        },
    });
    const acquiring = harness.assetRuntime.manager.Acquire("texture:first");
    await WaitUntil(() => typeof finishLoad === "function");

    harness.source.Emit("asset-change", {
        data: JSON.stringify({ paths: ["/assets/textures/first.png"] }),
    });
    finishLoad({ generation: 1 });
    const lease = await acquiring;
    await CommitWhenReady(harness.client);
    await WaitUntil(() => lease.Handle.Version === 2);

    assert.equal(lease.Handle.Current.generation, 2);
    harness.client.Dispose();
    await lease.Release();
    await harness.sceneManager.Dispose();
});

test("reloads the active scene after the event stream reconnects", async () => {
    const harness = await CreateHarness();
    harness.source.Emit("open");
    harness.sceneDocument = CreateSceneDocument("reconnected");
    harness.source.Emit("error");
    harness.source.Emit("open");
    await WaitUntil(() => harness.sceneManager.ActiveScene?.Name === "reconnected");

    assert.equal(harness.sceneFetchCount, 2);
    harness.client.Dispose();
    await harness.sceneManager.Dispose();
});

test("reloads a changed active scene through the scene manager", async () => {
    const harness = await CreateHarness();
    const initialScene = harness.sceneManager.ActiveScene;
    harness.sceneDocument = CreateSceneDocument("updated-main");

    harness.source.Emit("asset-change", {
        data: JSON.stringify({ paths: ["/assets/scenes/other.scene.json"] }),
    });
    await FlushTurns();
    assert.strictEqual(harness.sceneManager.ActiveScene, initialScene);
    assert.equal(harness.sceneFetchCount, 1);

    harness.source.Emit("asset-change", {
        data: JSON.stringify({ paths: [sceneUrl] }),
    });
    await WaitUntil(() => harness.sceneManager.ActiveScene?.Name === "updated-main");
    assert.notStrictEqual(harness.sceneManager.ActiveScene, initialScene);

    harness.client.Dispose();
    await harness.sceneManager.Dispose();
});

test("replaces the asset catalog and active scene after a version 1 manifest update", async () => {
    const replacementManifest = CreateManifest(["texture:replacement"]);
    const harness = await CreateHarness({
        fetchManifest: async () => replacementManifest,
    });
    const oldCatalog = harness.assetRuntime.catalog;
    const oldManager = harness.assetRuntime.manager;
    const oldScene = harness.sceneManager.ActiveScene;

    harness.source.Emit("asset-change", {
        data: JSON.stringify({ paths: ["/assets/asset-manifest.json"] }),
    });
    await WaitUntil(() => harness.assetRuntime.catalog.Has("texture:replacement") &&
        harness.sceneManager.ActiveScene !== oldScene);

    assert.notStrictEqual(harness.assetRuntime.catalog, oldCatalog);
    assert.notStrictEqual(harness.assetRuntime.manager, oldManager);
    assert.equal(harness.assetRuntime.catalog.Has("texture:first"), false);
    assert.equal(harness.sceneManager.ActiveScene.Name, "main");

    harness.client.Dispose();
    await harness.sceneManager.Dispose();
});

test("keeps the current runtime and scene when the replacement manifest is invalid", async () => {
    const harness = await CreateHarness({
        fetchManifest: async () => ({ format: "invalid", version: 1, assets: [] }),
    });
    const originalCatalog = harness.assetRuntime.catalog;
    const originalManager = harness.assetRuntime.manager;
    const originalScene = harness.sceneManager.ActiveScene;

    harness.source.Emit("asset-change", {
        data: JSON.stringify({ paths: ["/assets/asset-manifest.json"] }),
    });
    await FlushTurns();

    assert.strictEqual(harness.assetRuntime.catalog, originalCatalog);
    assert.strictEqual(harness.assetRuntime.manager, originalManager);
    assert.strictEqual(harness.sceneManager.ActiveScene, originalScene);
    harness.client.Dispose();
    await harness.sceneManager.Dispose();
});

test("preserves the active scene when a changed scene document is invalid", async () => {
    const harness = await CreateHarness();
    const originalScene = harness.sceneManager.ActiveScene;
    harness.sceneDocument = { format: "astral-scene", version: 1, entities: [] };

    harness.source.Emit("asset-change", {
        data: JSON.stringify({ paths: [sceneUrl] }),
    });
    await WaitUntil(() => harness.sceneFetchCount === 2);
    await FlushTurns();

    assert.strictEqual(harness.sceneManager.ActiveScene, originalScene);
    harness.client.Dispose();
    await harness.sceneManager.Dispose();
});
