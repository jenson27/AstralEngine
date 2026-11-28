import { Engine } from "../core/engine.js";
import { HotReloadClient } from "../core/hot-reload-client.js";
import { AstralLogger } from "../diagnostics/logger.js";

function RequireMethod(value, methodName, description) {
    if (!value || typeof value[methodName] !== "function") {
        throw new TypeError(
            `BrowserRuntime requires ${description} with ${methodName}().`,
        );
    }
}

async function RunCleanup(description, cleanup) {
    try {
        await cleanup();
    } catch (error) {
        AstralLogger.Error(`${description} cleanup failed.`, error);
    }
}

export class BrowserRuntime {
    constructor({
        platform,
        renderer,
        startSceneUrl,
        status = null,
        profiler = null,
        memoryTracker = null,
        signal = null,
        createRuntimeModules,
        createEngine = (...args) => new Engine(...args),
        createHotReloadClient = (assetRuntime, sceneManager) =>
            new HotReloadClient(assetRuntime, sceneManager),
    }) {
        RequireMethod(platform, "Start", "a platform");
        RequireMethod(platform, "Stop", "a platform");
        RequireMethod(renderer, "Initialize", "a renderer");
        RequireMethod(renderer, "Render", "a renderer");
        RequireMethod(renderer, "Shutdown", "a renderer");

        if (typeof startSceneUrl !== "string" || startSceneUrl.trim() === "") {
            throw new TypeError("BrowserRuntime requires a start scene URL.");
        }
        if (typeof createRuntimeModules !== "function") {
            throw new TypeError(
                "BrowserRuntime requires a runtime modules factory.",
            );
        }
        if (typeof createEngine !== "function") {
            throw new TypeError("BrowserRuntime engine factory must be a function.");
        }
        if (typeof createHotReloadClient !== "function") {
            throw new TypeError(
                "BrowserRuntime hot-reload factory must be a function.",
            );
        }
        if (
            signal !== null &&
            (typeof signal.aborted !== "boolean" ||
                typeof signal.addEventListener !== "function" ||
                typeof signal.removeEventListener !== "function")
        ) {
            throw new TypeError("BrowserRuntime requires a valid abort signal.");
        }

        this._platform = platform;
        this._renderer = renderer;
        this._startSceneUrl = startSceneUrl;
        this._status = status;
        this._profiler = profiler;
        this._memoryTracker = memoryTracker;
        this._externalSignal = signal;
        this._abortController = new AbortController();
        this._createRuntimeModules = createRuntimeModules;
        this._createEngine = createEngine;
        this._createHotReloadClient = createHotReloadClient;
        this._inputSource = null;
        this._inputManager = null;
        this._assetRuntime = null;
        this._sceneManager = null;
        this._hotReloadClient = null;
        this._engine = null;
        this._startPromise = null;
        this._disposePromise = null;
        this._cleanupPromise = null;
        this._isDisposed = false;
        this._assetMetadata = null;
        this._gpuTiming = Object.freeze({
            IsSupported: () => Boolean(this._renderer.GpuTimingSupported),
        });
        this._externalAbortListener = () => {
            void this.Dispose();
        };

        if (signal?.aborted) {
            void this.Dispose();
        } else {
            signal?.addEventListener("abort", this._externalAbortListener, {
                once: true,
            });
        }
    }

    get SceneManager() {
        return this._sceneManager;
    }

    GetAssetMetadata() {
        if (!this._assetRuntime) {
            throw new Error("BrowserRuntime has not initialized its assets.");
        }

        if (!this._assetMetadata) {
            this._assetMetadata = Object.freeze({
                GetAll: () => this._assetRuntime.catalog.GetAll(),
                GetRequired: (assetId) =>
                    this._assetRuntime.catalog.GetRequired(assetId),
                GetAssetIdsBySourcePath: (sourcePath) =>
                    this._assetRuntime.catalog.GetAssetIdsBySourcePath(
                        sourcePath,
                    ),
            });
        }

        return this._assetMetadata;
    }

    GetEditorCapabilities() {
        if (!this._sceneManager) {
            throw new Error("BrowserRuntime has not started.");
        }

        return Object.freeze({
            SceneManager: this._sceneManager,
            GetAssetMetadata: () => this.GetAssetMetadata(),
            GpuTiming: this._gpuTiming,
        });
    }

    get GpuTiming() {
        return this._gpuTiming;
    }

    Start() {
        if (this._isDisposed) {
            return Promise.reject(
                new Error("BrowserRuntime has been disposed."),
            );
        }
        if (!this._startPromise) {
            this._startPromise = this._Start();
        }
        return this._startPromise;
    }

    async _Start() {
        const startupOperations = [];
        try {
            this._platform.Start();

            const signal = this._abortController.signal;
            startupOperations.push(
                this._RunStartupTask(() =>
                    this._renderer.Initialize({ signal }),
                ),
                this._RunStartupTask(async () => {
                    const modules = await this._createRuntimeModules({
                        platform: this._platform,
                        renderer: this._renderer,
                        signal,
                    });
                    this._AssignRuntimeModules(modules);
                }),
            );
            await Promise.all(startupOperations);

            this._RequireNotDisposed();
            await this._sceneManager.LoadScene(this._startSceneUrl);
            this._RequireNotDisposed();

            this._hotReloadClient = this._createHotReloadClient(
                this._assetRuntime,
                this._sceneManager,
            );
            this._hotReloadClient.Connect();
            this._inputSource.Start();
            this._engine = this._createEngine(
                this._renderer,
                (deltaTime, elapsedTime, diagnostics) => {
                    this._inputManager.Update();
                    this._sceneManager.FixedUpdate(
                        deltaTime,
                        elapsedTime,
                        diagnostics,
                    );
                },
                (interpolationAlpha, diagnostics) => {
                    this._hotReloadClient.CommitAtFrameBoundary();

                    if (this._sceneManager.ActiveScene) {
                        this._sceneManager.PrepareRender(
                            interpolationAlpha,
                            this._platform.Canvas.width /
                                this._platform.Canvas.height,
                            diagnostics,
                        );
                    } else {
                        this._renderer.ClearRenderItems();
                    }
                },
                { profiler: this._profiler, memoryTracker: this._memoryTracker },
            );
            this._engine.Start();

            AstralLogger.Info("Scene loaded and WebGPU ready.", {
                sceneName: this._sceneManager.ActiveScene.Name,
                canvasWidth: this._platform.Canvas.width,
                canvasHeight: this._platform.Canvas.height,
            });
            if (this._status) {
                this._status.textContent = "Scene loaded. WebGPU ready.";
            }
        } catch (error) {
            this._isDisposed = true;
            this._abortController.abort(error);
            await Promise.allSettled(startupOperations);
            await this._CleanupResources();
            throw error;
        }
    }

    Dispose() {
        if (this._disposePromise) {
            return this._disposePromise;
        }

        this._isDisposed = true;
        this._abortController.abort();
        this._externalSignal?.removeEventListener(
            "abort",
            this._externalAbortListener,
        );
        this._disposePromise = (async () => {
            await this._startPromise?.catch(() => {});
            await this._CleanupResources();
        })();

        return this._disposePromise;
    }

    async _RunStartupTask(startupOperation) {
        try {
            return await startupOperation();
        } catch (error) {
            this._abortController.abort(error);
            throw error;
        }
    }

    _CleanupResources() {
        if (!this._cleanupPromise) {
            this._externalSignal?.removeEventListener(
                "abort",
                this._externalAbortListener,
            );
            this._cleanupPromise = (async () => {
                await RunCleanup("Engine", () => this._engine?.Stop());
                await RunCleanup("Input", () => this._inputSource?.Stop());
                await RunCleanup("Hot-reload", () =>
                    this._hotReloadClient?.Dispose(),
                );
                await RunCleanup("Scene", () => this._sceneManager?.Dispose());
                await RunCleanup("Renderer", () => this._renderer.Shutdown());
                await RunCleanup("Platform", () => this._platform.Stop());
            })();
        }

        return this._cleanupPromise;
    }

    _AssignRuntimeModules(modules) {
        if (
            !modules ||
            !modules.inputSource ||
            typeof modules.inputSource.Start !== "function" ||
            typeof modules.inputSource.Stop !== "function" ||
            !modules.inputManager ||
            typeof modules.inputManager.Update !== "function" ||
            !modules.assetRuntime?.catalog ||
            !modules.assetRuntime?.manager ||
            !modules.sceneManager ||
            typeof modules.sceneManager.LoadScene !== "function" ||
            typeof modules.sceneManager.FixedUpdate !== "function" ||
            typeof modules.sceneManager.PrepareRender !== "function" ||
            typeof modules.sceneManager.Dispose !== "function"
        ) {
            throw new TypeError(
                "Runtime modules factory returned an invalid module set.",
            );
        }

        this._inputSource = modules.inputSource;
        this._inputManager = modules.inputManager;
        this._assetRuntime = modules.assetRuntime;
        this._sceneManager = modules.sceneManager;
    }

    _RequireNotDisposed() {
        if (this._isDisposed) {
            throw new Error("BrowserRuntime has been disposed.");
        }
    }
}
