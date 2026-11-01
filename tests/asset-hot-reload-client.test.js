import assert from "node:assert/strict";
import test from "node:test";
import { AssetCatalog } from "../src/core/assets/asset-catalog.js";
import { AssetLoaderRegistry } from "../src/core/assets/asset-loader-registry.js";
import { HotReloadClient } from "../src/core/hot-reload-client.js";

class FakeEventSource {
    constructor(url) {
        this.url = url;
        this.closeCount = 0;
        this._listenersByType = new Map();
    }

    addEventListener(type, listener) {
        const listeners = this._listenersByType.get(type) ?? [];
        listeners.push(listener);
        this._listenersByType.set(type, listeners);
    }

    Emit(type, event) {
        for (const listener of this._listenersByType.get(type) ?? []) {
            listener(event);
        }
    }

    close() {
        this.closeCount += 1;
    }
}

function CreateLogger() {
    return {
        Error() {},
        Info() {},
        Warn() {},
    };
}

function CreateCatalog() {
    const catalog = new AssetCatalog();

    catalog.RegisterManifest({
        format: "astral-assets",
        version: 1,
        assets: [
            {
                id: "texture:first",
                typeId: "texture",
                loaderId: "image:texture",
                source: {
                    kind: "image",
                    url: "/assets/textures/first.jpg",
                },
                version: 1,
            },
            {
                id: "texture:second",
                typeId: "texture",
                loaderId: "image:texture",
                source: {
                    kind: "image",
                    url: "/assets/textures/second.jpg",
                },
                version: 1,
            },
        ],
    });

    return catalog;
}

function WaitForMicrotasks() {
    return new Promise((resolve) => setImmediate(resolve));
}

test("queues file changes until each staged reload commits", async () => {
    const stageCalls = [];
    const cleanupResolvers = [];
    let source;
    const sceneManager = {
        ActiveSceneUrl: "/assets/scenes/main.scene.json",
        LoadScene() {
            throw new Error("Asset events must not reload the scene.");
        },
    };
    const manager = {
        GetLoadedAssetIds() {
            return ["texture:first", "texture:second"];
        },
        GetState(assetId) {
            return this.GetLoadedAssetIds().includes(assetId)
                ? "loaded"
                : "unloaded";
        },
        StageReload(assetIds) {
            stageCalls.push([...assetIds]);
            return Promise.resolve({ affectedAssetIds: [...assetIds] });
        },
        CommitStagedReload() {
            return new Promise((resolve) => {
                cleanupResolvers.push(resolve);
            });
        },
    };
    const assetRuntime = {
        catalog: CreateCatalog(),
        loaderRegistry: new AssetLoaderRegistry(),
        manager,
    };
    const client = new HotReloadClient(
        assetRuntime,
        sceneManager,
        {
            EventSourceClass: class extends FakeEventSource {
                constructor(url) {
                    super(url);
                    source = this;
                }
            },
            logger: CreateLogger(),
        },
    );

    assert.equal(client.Connect(), true);
    assert.equal(source.url, "/api/hot-reload");

    source.Emit("asset-change", {
        data: JSON.stringify({
            paths: ["/assets/textures/first.jpg"],
        }),
    });

    assert.deepEqual(stageCalls, [["texture:first"]]);
    assert.equal(client.CommitAtFrameBoundary(), false);

    await WaitForMicrotasks();
    assert.equal(client.CommitAtFrameBoundary(), true);

    source.Emit("asset-change", {
        data: JSON.stringify({
            paths: ["/assets/textures/second.jpg"],
        }),
    });
    assert.deepEqual(stageCalls, [["texture:first"]]);

    cleanupResolvers[0]({ assetIds: ["texture:first"] });
    await WaitForMicrotasks();

    assert.deepEqual(stageCalls, [
        ["texture:first"],
        ["texture:second"],
    ]);
    assert.equal(client.CommitAtFrameBoundary(), true);

    cleanupResolvers[1]({ assetIds: ["texture:second"] });
    await WaitForMicrotasks();

    client.Dispose();
    assert.equal(source.closeCount, 1);
});

test("stages an asset change that arrives while the asset is loading", async () => {
    const stagedAssetIds = [];
    let source;
    const manager = {
        GetState(assetId) {
            return assetId === "texture:first" ? "loading" : "unloaded";
        },
        StageReload(assetIds) {
            stagedAssetIds.push([...assetIds]);
            return Promise.resolve({ affectedAssetIds: [...assetIds] });
        },
        CommitStagedReload() {
            return Promise.resolve({ assetIds: ["texture:first"] });
        },
    };
    const assetRuntime = {
        catalog: CreateCatalog(),
        loaderRegistry: new AssetLoaderRegistry(),
        manager,
    };
    const client = new HotReloadClient(
        assetRuntime,
        {
            ActiveSceneUrl: "/assets/scenes/main.scene.json",
            LoadScene() {
                throw new Error("No scene reload should occur.");
            },
        },
        {
            EventSourceClass: class extends FakeEventSource {
                constructor(url) {
                    super(url);
                    source = this;
                }
            },
            logger: CreateLogger(),
        },
    );

    client.Connect();
    source.Emit("asset-change", {
        data: JSON.stringify({
            paths: ["/assets/textures/first.jpg"],
        }),
    });

    assert.deepEqual(stagedAssetIds, [["texture:first"]]);

    await WaitForMicrotasks();
    client.Dispose();
});

test("reloads the active scene after the event stream reconnects", async () => {
    let source;
    let loadSceneCount = 0;
    const previousScene = { Name: "main" };
    const sceneManager = {
        ActiveScene: previousScene,
        ActiveSceneUrl: "/assets/scenes/main.scene.json",
        async LoadScene() {
            loadSceneCount += 1;
            this.ActiveScene = { Name: "main-reloaded" };
            return this.ActiveScene;
        },
    };
    const assetRuntime = {
        catalog: CreateCatalog(),
        loaderRegistry: new AssetLoaderRegistry(),
        manager: {
            GetState() {
                return "unloaded";
            },
            StageReload() {
                throw new Error("No asset reload should be staged.");
            },
            CommitStagedReload() {
                return null;
            },
        },
    };
    const client = new HotReloadClient(
        assetRuntime,
        sceneManager,
        {
            EventSourceClass: class extends FakeEventSource {
                constructor(url) {
                    super(url);
                    source = this;
                }
            },
            fetchFunction: async () => ({
                ok: true,
                status: 200,
                json: async () => ({
                    format: "astral-assets",
                    version: 1,
                    assets: [],
                }),
            }),
            logger: CreateLogger(),
        },
    );

    client.Connect();
    source.Emit("open");
    assert.equal(loadSceneCount, 0);

    source.Emit("error");
    source.Emit("open");
    await WaitForMicrotasks();

    assert.equal(loadSceneCount, 1);
    assert.equal(sceneManager.ActiveScene.Name, "main-reloaded");
    client.Dispose();
});

test("reloads only the active scene when its file changes", async () => {
    const loadedScenes = [];
    const stagedAssetIds = [];
    let resolveCleanup;
    let source;
    const sceneUrl = "/assets/scenes/main.scene.json";
    const manager = {
        GetLoadedAssetIds() {
            return ["texture:first"];
        },
        GetState(assetId) {
            return this.GetLoadedAssetIds().includes(assetId)
                ? "loaded"
                : "unloaded";
        },
        StageReload(assetIds) {
            stagedAssetIds.push([...assetIds]);
            return Promise.resolve({ affectedAssetIds: [...assetIds] });
        },
        CommitStagedReload() {
            return new Promise((resolve) => {
                resolveCleanup = resolve;
            });
        },
    };
    const assetRuntime = {
        catalog: CreateCatalog(),
        loaderRegistry: new AssetLoaderRegistry(),
        manager,
    };
    const sceneManager = {
        ActiveSceneUrl: sceneUrl,
        async LoadScene(url) {
            loadedScenes.push(url);
            return { Name: "main" };
        },
    };
    const client = new HotReloadClient(
        assetRuntime,
        sceneManager,
        {
            EventSourceClass: class extends FakeEventSource {
                constructor(url) {
                    super(url);
                    source = this;
                }
            },
            logger: CreateLogger(),
        },
    );

    client.Connect();
    source.Emit("asset-change", {
        data: JSON.stringify({
            paths: [
                "/assets/scenes/other.scene.json",
            ],
        }),
    });
    assert.deepEqual(loadedScenes, []);

    source.Emit("asset-change", {
        data: JSON.stringify({
            paths: ["/assets/textures/first.jpg", sceneUrl],
        }),
    });
    assert.deepEqual(stagedAssetIds, [["texture:first"]]);
    assert.deepEqual(loadedScenes, []);

    await WaitForMicrotasks();
    assert.equal(client.CommitAtFrameBoundary(), true);
    resolveCleanup({ assetIds: ["texture:first"] });
    await WaitForMicrotasks();

    assert.deepEqual(stagedAssetIds, [["texture:first"]]);
    assert.deepEqual(loadedScenes, [sceneUrl]);
    client.Dispose();
});

test("loads the changed manifest and scene with a replacement asset runtime", async () => {
    let source;
    const originalManager = {
        GetLoadedAssetIds() {
            return [];
        },
        GetState() {
            return "unloaded";
        },
        StageReload() {
            throw new Error("The old manager must not stage this reload.");
        },
        CommitStagedReload() {
            return null;
        },
    };
    const previousScene = { Name: "previous" };
    const replacementScene = { Name: "replacement" };
    const sceneUrl = "/assets/scenes/main.scene.json";
    const assetRuntime = {
        catalog: CreateCatalog(),
        loaderRegistry: new AssetLoaderRegistry(),
        manager: originalManager,
    };
    const sceneManager = {
        ActiveScene: previousScene,
        ActiveSceneUrl: sceneUrl,
        async LoadScene(url) {
            assert.equal(url, sceneUrl);
            assert.notStrictEqual(assetRuntime.manager, originalManager);
            this.ActiveScene = replacementScene;
            return replacementScene;
        },
    };
    const manifest = {
        format: "astral-assets",
        version: 1,
        assets: [
            {
                id: "texture:replacement",
                typeId: "texture",
                loaderId: "image:texture",
                source: {
                    kind: "image",
                    url: "/assets/textures/replacement.jpg",
                },
                version: 1,
            },
        ],
    };
    const fetchCalls = [];
    const client = new HotReloadClient(
        assetRuntime,
        sceneManager,
        {
            EventSourceClass: class extends FakeEventSource {
                constructor(url) {
                    super(url);
                    source = this;
                }
            },
            fetchFunction: async (url, options) => {
                fetchCalls.push({ url, options });
                return {
                    ok: true,
                    status: 200,
                    json: async () => manifest,
                };
            },
            logger: CreateLogger(),
        },
    );

    client.Connect();
    source.Emit("asset-change", {
        data: JSON.stringify({
            paths: ["/assets/asset-manifest.json"],
        }),
    });
    await WaitForMicrotasks();

    assert.deepEqual(fetchCalls, [
        {
            url: "/assets/asset-manifest.json",
            options: { cache: "no-store" },
        },
    ]);
    assert.equal(assetRuntime.catalog.Has("texture:replacement"), true);
    assert.notStrictEqual(assetRuntime.manager, originalManager);
    assert.strictEqual(sceneManager.ActiveScene, replacementScene);

    client.Dispose();
});

test("keeps the current asset runtime when the new manifest is invalid", async () => {
    let source;
    let loadSceneCount = 0;
    const originalManager = {
        GetLoadedAssetIds() {
            return [];
        },
        GetState() {
            return "unloaded";
        },
        StageReload() {
            throw new Error("No assets should be staged.");
        },
        CommitStagedReload() {
            return null;
        },
    };
    const previousScene = { Name: "main" };
    const assetRuntime = {
        catalog: CreateCatalog(),
        loaderRegistry: new AssetLoaderRegistry(),
        manager: originalManager,
    };
    const sceneManager = {
        ActiveScene: previousScene,
        ActiveSceneUrl: "/assets/scenes/main.scene.json",
        async LoadScene() {
            loadSceneCount += 1;
            throw new Error("Invalid manifests must not load a scene.");
        },
    };
    const originalCatalog = assetRuntime.catalog;
    const client = new HotReloadClient(
        assetRuntime,
        sceneManager,
        {
            EventSourceClass: class extends FakeEventSource {
                constructor(url) {
                    super(url);
                    source = this;
                }
            },
            fetchFunction: async () => ({
                ok: true,
                status: 200,
                json: async () => ({ format: "invalid" }),
            }),
            logger: CreateLogger(),
        },
    );

    client.Connect();
    source.Emit("asset-change", {
        data: JSON.stringify({
            paths: ["/assets/asset-manifest.json"],
        }),
    });
    await WaitForMicrotasks();

    assert.strictEqual(assetRuntime.catalog, originalCatalog);
    assert.strictEqual(assetRuntime.manager, originalManager);
    assert.strictEqual(sceneManager.ActiveScene, previousScene);
    assert.equal(loadSceneCount, 0);

    client.Dispose();
});

test("restores the current asset runtime when the replacement scene fails", async () => {
    let source;
    const originalManager = {
        GetLoadedAssetIds() {
            return [];
        },
        GetState() {
            return "unloaded";
        },
        StageReload() {
            throw new Error("No assets should be staged.");
        },
        CommitStagedReload() {
            return null;
        },
    };
    const previousScene = { Name: "main" };
    const assetRuntime = {
        catalog: CreateCatalog(),
        loaderRegistry: new AssetLoaderRegistry(),
        manager: originalManager,
    };
    const sceneManager = {
        ActiveScene: previousScene,
        ActiveSceneUrl: "/assets/scenes/main.scene.json",
        async LoadScene() {
            throw new Error("Scene loading failed.");
        },
    };
    const originalCatalog = assetRuntime.catalog;
    const client = new HotReloadClient(
        assetRuntime,
        sceneManager,
        {
            EventSourceClass: class extends FakeEventSource {
                constructor(url) {
                    super(url);
                    source = this;
                }
            },
            fetchFunction: async () => ({
                ok: true,
                status: 200,
                json: async () => ({
                    format: "astral-assets",
                    version: 1,
                    assets: [],
                }),
            }),
            logger: CreateLogger(),
        },
    );

    client.Connect();
    source.Emit("asset-change", {
        data: JSON.stringify({
            paths: ["/assets/asset-manifest.json"],
        }),
    });
    await WaitForMicrotasks();

    assert.strictEqual(assetRuntime.catalog, originalCatalog);
    assert.strictEqual(assetRuntime.manager, originalManager);
    assert.strictEqual(sceneManager.ActiveScene, previousScene);

    client.Dispose();
});
