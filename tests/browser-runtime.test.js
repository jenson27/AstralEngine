import assert from "node:assert/strict";
import test from "node:test";
import { BrowserRuntime } from "../src/browser/browser-runtime.js";

function CreateDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function CreateRuntimeFixture({
    rendererInitialize = async () => {},
    createRuntimeModules = null,
    sceneLoad = null,
    signal = null,
} = {}) {
    const calls = [];
    const catalog = {
        GetAll: () => [{ id: "mesh:cube" }],
        GetRequired: (assetId) => ({ id: assetId }),
        GetAssetIdsBySourcePath: () => ["mesh:cube"],
    };
    const platform = {
        Canvas: { width: 800, height: 400 },
        Start() {
            calls.push("platform.start");
        },
        Stop() {
            calls.push("platform.stop");
        },
    };
    const renderer = {
        GpuTimingSupported: true,
        Initialize(options) {
            calls.push("renderer.initialize");
            return rendererInitialize(options);
        },
        Render() {
            calls.push("renderer.render");
        },
        ClearRenderItems() {
            calls.push("renderer.clear");
        },
        Shutdown() {
            calls.push("renderer.shutdown");
        },
    };
    const inputSource = {
        Start() {
            calls.push("input.start");
        },
        Stop() {
            calls.push("input.stop");
        },
    };
    const inputManager = {
        Update() {
            calls.push("input.update");
        },
    };
    const sceneManager = {
        ActiveScene: { Name: "test-scene" },
        async LoadScene(url, signal) {
            calls.push(["scene.load", url]);
            return sceneLoad?.(url, signal);
        },
        FixedUpdate(...args) {
            calls.push(["scene.fixed-update", ...args]);
        },
        PrepareRender(...args) {
            calls.push(["scene.prepare-render", ...args]);
        },
        async Dispose() {
            calls.push("scene.dispose");
        },
    };
    let fixedUpdate;
    let prepareRender;
    const runtime = new BrowserRuntime({
        platform,
        renderer,
        startSceneUrl: "/scenes/test.json",
        signal,
        createRuntimeModules:
            createRuntimeModules ??
            (async ({ signal }) => {
                calls.push("modules.create");
                sceneManager.LoadScene = (url) => {
                    calls.push(["scene.load", url]);
                    return sceneLoad?.(url, signal) ?? Promise.resolve();
                };
                return {
                    inputSource,
                    inputManager,
                    assetRuntime: { catalog, manager: {} },
                    sceneManager,
                };
            }),
        createHotReloadClient: () => {
            calls.push("hot-reload.create");
            return {
                Connect: () => calls.push("hot-reload.connect"),
                CommitAtFrameBoundary: () =>
                    calls.push("hot-reload.commit"),
                Dispose: () => calls.push("hot-reload.dispose"),
            };
        },
        createEngine: (_renderer, fixedUpdateCallback, prepareRenderCallback) => {
            calls.push("engine.create");
            fixedUpdate = fixedUpdateCallback;
            prepareRender = prepareRenderCallback;
            return {
                Start: () => calls.push("engine.start"),
                Stop: () => calls.push("engine.stop"),
            };
        },
    });

    return {
        calls,
        runtime,
        sceneManager,
        RunFixedUpdate: (...args) => fixedUpdate(...args),
        RunPrepareRender: (...args) => prepareRender(...args),
    };
}

test("coordinates runtime startup, frame work, and ordered disposal", async () => {
    const fixture = CreateRuntimeFixture();
    await fixture.runtime.Start();

    assert.deepEqual(fixture.calls.slice(0, 8), [
        "platform.start",
        "renderer.initialize",
        "modules.create",
        ["scene.load", "/scenes/test.json"],
        "hot-reload.create",
        "hot-reload.connect",
        "input.start",
        "engine.create",
    ]);
    assert.equal(fixture.calls[8], "engine.start");

    fixture.RunFixedUpdate(1 / 60, 1 / 60, null);
    fixture.RunPrepareRender(0.5, null);
    fixture.sceneManager.ActiveScene = null;
    fixture.RunPrepareRender(0.25, null);

    assert.deepEqual(fixture.calls.slice(9), [
        "input.update",
        ["scene.fixed-update", 1 / 60, 1 / 60, null],
        "hot-reload.commit",
        ["scene.prepare-render", 0.5, 2, null],
        "hot-reload.commit",
        "renderer.clear",
    ]);

    const editorCapabilities = fixture.runtime.GetEditorCapabilities();
    assert.strictEqual(editorCapabilities.SceneManager, fixture.sceneManager);
    assert.deepEqual(editorCapabilities.GetAssetMetadata().GetAll(), [
        { id: "mesh:cube" },
    ]);
    assert.equal(editorCapabilities.GpuTiming.IsSupported(), true);
    assert.equal("Renderer" in editorCapabilities, false);

    await Promise.all([
        fixture.runtime.Dispose(),
        fixture.runtime.Dispose(),
    ]);
    assert.deepEqual(fixture.calls.slice(-6), [
        "engine.stop",
        "input.stop",
        "hot-reload.dispose",
        "scene.dispose",
        "renderer.shutdown",
        "platform.stop",
    ]);
});

test("cleans initialized modules after renderer startup fails", async () => {
    const initializationError = new Error("GPU initialization failed.");
    const fixture = CreateRuntimeFixture({
        rendererInitialize: async () => {
            throw initializationError;
        },
    });

    await assert.rejects(fixture.runtime.Start(), initializationError);
    assert.deepEqual(fixture.calls.slice(-3), [
        "scene.dispose",
        "renderer.shutdown",
        "platform.stop",
    ]);
    assert.equal(fixture.calls.includes("scene.load"), false);
    assert.equal(fixture.calls.includes("engine.start"), false);
});

test("waits for in-flight initialization before disposing resources", async () => {
    const rendererStarted = CreateDeferred();
    const rendererCompletion = CreateDeferred();
    const fixture = CreateRuntimeFixture({
        rendererInitialize: ({ signal }) => {
            rendererStarted.resolve(signal);
            return rendererCompletion.promise;
        },
    });

    const startPromise = fixture.runtime.Start();
    const signal = await rendererStarted.promise;
    const disposePromise = fixture.runtime.Dispose();

    assert.equal(signal.aborted, true);
    assert.equal(fixture.calls.includes("renderer.shutdown"), false);

    rendererCompletion.resolve();
    await assert.rejects(startPromise, /disposed/);
    await disposePromise;

    assert.equal(
        fixture.calls.filter((call) => call === "renderer.shutdown").length,
        1,
    );
    assert.equal(
        fixture.calls.filter((call) => call === "platform.stop").length,
        1,
    );
    assert.equal(fixture.calls.includes("scene.load"), false);
});

test("aborts the other startup task when runtime module creation fails", async () => {
    const startupError = new Error("Input map failed to load.");
    let rendererSignal;
    const fixture = CreateRuntimeFixture({
        rendererInitialize: ({ signal }) => {
            rendererSignal = signal;
            return new Promise((_resolve, reject) => {
                signal.addEventListener(
                    "abort",
                    () => reject(signal.reason),
                    { once: true },
                );
            });
        },
        createRuntimeModules: async () => {
            throw startupError;
        },
    });

    await assert.rejects(fixture.runtime.Start(), startupError);

    assert.equal(rendererSignal.aborted, true);
    assert.deepEqual(fixture.calls.slice(-2), [
        "renderer.shutdown",
        "platform.stop",
    ]);
});

test("aborts and drains a scene load before disposing its runtime", async () => {
    const sceneLoadStarted = CreateDeferred();
    const externalAbortController = new AbortController();
    const fixture = CreateRuntimeFixture({
        signal: externalAbortController.signal,
        sceneLoad: (url, signal) => {
            assert.equal(url, "/scenes/test.json");
            sceneLoadStarted.resolve(signal);
            return new Promise((_resolve, reject) => {
                signal.addEventListener(
                    "abort",
                    () => reject(signal.reason),
                    { once: true },
                );
            });
        },
    });

    const startPromise = fixture.runtime.Start();
    const signal = await sceneLoadStarted.promise;
    externalAbortController.abort();

    assert.equal(signal.aborted, true);
    await assert.rejects(startPromise);
    await fixture.runtime.Dispose();

    assert.equal(fixture.calls.includes("scene.dispose"), true);
    assert.equal(fixture.calls.includes("engine.start"), false);
});
