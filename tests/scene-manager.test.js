import assert from "node:assert/strict";
import test from "node:test";
import { SceneManager } from "../src/core/scene-manager.js";

function CreateScene(name, calls = []) {
    return {
        Name: name,
        Calls: calls,

        FixedUpdate(deltaTime, elapsedTime) {
            calls.push(["FixedUpdate", name, deltaTime, elapsedTime]);
        },

        PrepareRender(interpolationAlpha, aspectRatio) {
            calls.push([
                "PrepareRender",
                name,
                interpolationAlpha,
                aspectRatio,
            ]);
        },

        Dispose() {
            calls.push(["Dispose", name]);
        },
    };
}

test("loads a scene and forwards engine callbacks", async () => {
    const scene = CreateScene("level-one");
    const loadCalls = [];
    const manager = new SceneManager(
        {
            async Load(url, options) {
                loadCalls.push({ url, options });
                return scene;
            },
        },
        (url) => ({ services: { requestedUrl: url } }),
    );

    const loadedScene = await manager.LoadScene("/scenes/level-one.json");

    assert.strictEqual(loadedScene, scene);
    assert.strictEqual(manager.ActiveScene, scene);
    assert.deepEqual(loadCalls, [
        {
            url: "/scenes/level-one.json",
            options: {
                services: {
                    requestedUrl: "/scenes/level-one.json",
                },
            },
        },
    ]);

    manager.FixedUpdate(1 / 60, 1 / 60);
    manager.PrepareRender(0.5, 16 / 9);

    assert.deepEqual(scene.Calls, [
        ["FixedUpdate", "level-one", 1 / 60, 1 / 60],
        ["PrepareRender", "level-one", 0.5, 16 / 9],
    ]);

    manager.Dispose();

    assert.deepEqual(scene.Calls[2], ["Dispose", "level-one"]);
});

test("replaces and disposes the previous scene after loading the next", async () => {
    const calls = [];
    const firstScene = CreateScene("first", calls);
    const secondScene = CreateScene("second", calls);
    const scenes = new Map([
        ["/scenes/first.json", firstScene],
        ["/scenes/second.json", secondScene],
    ]);
    const manager = new SceneManager({
        async Load(url) {
            calls.push(["Load", url]);
            return scenes.get(url);
        },
    });

    await manager.LoadScene("/scenes/first.json");
    await manager.LoadScene("/scenes/second.json");

    assert.strictEqual(manager.ActiveScene, secondScene);
    assert.deepEqual(calls, [
        ["Load", "/scenes/first.json"],
        ["Load", "/scenes/second.json"],
        ["Dispose", "first"],
    ]);

    manager.Dispose();
    assert.deepEqual(calls[3], ["Dispose", "second"]);
});

test("keeps the active scene when the next scene fails to load", async () => {
    const activeScene = CreateScene("active");
    const manager = new SceneManager({
        async Load(url) {
            if (url === "/scenes/broken.json") {
                throw new Error("Scene request failed.");
            }

            return activeScene;
        },
    });

    await manager.LoadScene("/scenes/active.json");

    await assert.rejects(
        manager.LoadScene("/scenes/broken.json"),
        /Scene request failed/,
    );

    assert.strictEqual(manager.ActiveScene, activeScene);
    assert.deepEqual(activeScene.Calls, []);

    manager.Dispose();
});

test("rejects a second scene load while one is in progress", async () => {
    let resolveLoad;
    const pendingLoad = new Promise((resolve) => {
        resolveLoad = resolve;
    });
    const manager = new SceneManager({
        Load() {
            return pendingLoad;
        },
    });

    const firstLoad = manager.LoadScene("/scenes/first.json");

    await assert.rejects(
        manager.LoadScene("/scenes/second.json"),
        /already in progress/,
    );

    const scene = CreateScene("first");
    resolveLoad(scene);
    await firstLoad;

    assert.strictEqual(manager.ActiveScene, scene);
    manager.Dispose();
});

test("disposes a scene that finishes loading after the manager is disposed", async () => {
    let resolveLoad;
    const pendingLoad = new Promise((resolve) => {
        resolveLoad = resolve;
    });
    const manager = new SceneManager({
        Load() {
            return pendingLoad;
        },
    });

    const loadPromise = manager.LoadScene("/scenes/late.json");
    manager.Dispose();

    const lateScene = CreateScene("late");
    resolveLoad(lateScene);

    await assert.rejects(loadPromise, /disposed/);

    assert.strictEqual(manager.ActiveScene, null);
    assert.deepEqual(lateScene.Calls, [["Dispose", "late"]]);
});
