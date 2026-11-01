import assert from "node:assert/strict";
import test from "node:test";
import { SceneManager } from "../src/core/scene-manager.js";

function CreateScene(name, calls = []) {
    return {
        Name: name,
        Calls: calls,

        FixedUpdate() {},

        PrepareRender() {},

        Dispose() {
            calls.push(["Dispose", name]);
        },
    };
}

function CreateAssetScope(name, releaseCalls) {
    return {
        Acquire() {
            return Promise.resolve({});
        },

        ReleaseAll() {
            releaseCalls.push(name);
        },
    };
}

test("creates a scope and forwards it to scene loading", async () => {
    const releaseCalls = [];
    const scope = CreateAssetScope("scope", releaseCalls);
    const scene = CreateScene("scene");
    let receivedScope;
    const manager = new SceneManager(
        {
            async Load(url, options) {
                receivedScope = options.assetScope;
                return scene;
            },
        },
        () => ({}),
        () => scope,
    );

    await manager.LoadScene("/scenes/scene.json");

    assert.strictEqual(receivedScope, scope);
    assert.strictEqual(manager.ActiveScene, scene);
    assert.equal(manager.ActiveSceneUrl, "/scenes/scene.json");
    assert.deepEqual(releaseCalls, []);

    await manager.Dispose();
    assert.equal(manager.ActiveSceneUrl, null);
});

test("releases the previous scope after replacing its scene", async () => {
    const releaseCalls = [];
    const scopes = [
        CreateAssetScope("first", releaseCalls),
        CreateAssetScope("second", releaseCalls),
    ];
    const scenes = new Map([
        ["/scenes/first.json", CreateScene("first")],
        ["/scenes/second.json", CreateScene("second")],
    ]);
    let scopeIndex = 0;
    let loadIndex = 0;
    const manager = new SceneManager(
        {
            async Load(url, options) {
                assert.strictEqual(options.assetScope, scopes[loadIndex]);
                loadIndex += 1;
                return scenes.get(url);
            },
        },
        () => ({}),
        () => scopes[scopeIndex++],
    );

    await manager.LoadScene("/scenes/first.json");
    assert.equal(manager.ActiveSceneUrl, "/scenes/first.json");
    await manager.LoadScene("/scenes/second.json");

    assert.deepEqual(releaseCalls, ["first"]);
    assert.equal(manager.ActiveSceneUrl, "/scenes/second.json");
    assert.strictEqual(
        manager.ActiveScene,
        scenes.get("/scenes/second.json"),
    );

    await manager.Dispose();

    assert.deepEqual(releaseCalls, ["first", "second"]);
});

test("releases a failed pending scope and keeps the active scene", async () => {
    const releaseCalls = [];
    const scopes = [
        CreateAssetScope("active", releaseCalls),
        CreateAssetScope("failed", releaseCalls),
    ];
    const activeScene = CreateScene("active");
    let scopeIndex = 0;
    const manager = new SceneManager(
        {
            async Load(url) {
                if (url === "/scenes/broken.json") {
                    throw new Error("Scene request failed.");
                }

                return activeScene;
            },
        },
        () => ({}),
        () => scopes[scopeIndex++],
    );

    await manager.LoadScene("/scenes/active.json");

    await assert.rejects(
        manager.LoadScene("/scenes/broken.json"),
        /Scene request failed/,
    );

    assert.strictEqual(manager.ActiveScene, activeScene);
    assert.equal(manager.ActiveSceneUrl, "/scenes/active.json");
    assert.deepEqual(releaseCalls, ["failed"]);

    await manager.Dispose();

    assert.deepEqual(releaseCalls, ["failed", "active"]);
});

test("releases a pending scope if the manager is disposed during loading", async () => {
    let completeLoad;
    const releaseCalls = [];
    const scope = CreateAssetScope("pending", releaseCalls);
    const pendingLoad = new Promise((resolve) => {
        completeLoad = resolve;
    });
    const manager = new SceneManager(
        {
            Load() {
                return pendingLoad;
            },
        },
        () => ({}),
        () => scope,
    );

    const loadPromise = manager.LoadScene("/scenes/late.json");
    let disposeCompleted = false;
    const disposePromise = manager.Dispose().then(() => {
        disposeCompleted = true;
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(disposeCompleted, false);

    const lateScene = CreateScene("late");
    completeLoad(lateScene);

    await assert.rejects(loadPromise, /disposed/);
    await disposePromise;

    assert.equal(disposeCompleted, true);
    assert.strictEqual(manager.ActiveScene, null);
    assert.deepEqual(lateScene.Calls, [["Dispose", "late"]]);
    assert.deepEqual(releaseCalls, ["pending"]);
});
