// This module starts the shared browser application used by the game and editor.

import { BrowserPlatform } from "./platform/browser-platform.js";
import { BrowserInputSource } from "./platform/browser-input-source.js";
import { InputManager } from "./core/input/input-manager.js";
import { WebGPURenderer } from "./graphics/webgpu-renderer.js";
import { Engine } from "./core/engine.js";
import { AstralLogger } from "./diagnostics/logger.js";
import { AngularVelocitySystem } from "./systems/angular-velocity-system.js";
import { TransformSnapshotSystem } from "./systems/transform-snapshot-system.js";
import { CameraControlSystem } from "./systems/camera-control-system.js";
import { TransformHierarchySystem } from "./systems/transform-hierarchy-system.js";
import { RenderSystem } from "./systems/render-system.js";
import { SceneLoader } from "./core/scene-loader.js";
import { SceneManager } from "./core/scene-manager.js";
import { SystemPhase } from "./core/system-scheduler.js";
import { CreateSceneComponentRegistry } from "./components/register-scene-components.js";
import { AssetCatalog } from "./core/assets/asset-catalog.js";
import { AssetLoaderRegistry } from "./core/assets/asset-loader-registry.js";
import { AssetManager } from "./core/assets/asset-manager.js";
import { HotReloadClient } from "./core/hot-reload-client.js";
import { AssetScope } from "./core/assets/asset-scope.js";
import { BuiltinMeshLoader } from "./graphics/assets/builtin-mesh-loader.js";
import { ImageTextureLoader } from "./graphics/assets/image-texture-loader.js";
import { MaterialLoader } from "./graphics/assets/material-loader.js";

async function FetchRequiredResponse(url, resourceName) {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(
            `Could not load ${resourceName}. HTTP ${response.status}.`,
        );
    }

    return response;
}

async function CreateAssetRuntime(memoryTracker) {
    const manifestResponse = await FetchRequiredResponse(
        "/assets/asset-manifest.json",
        "asset manifest",
    );
    const assetCatalog = new AssetCatalog();
    assetCatalog.RegisterManifest(await manifestResponse.json());

    const assetLoaderRegistry = new AssetLoaderRegistry();
    assetLoaderRegistry.Register(
        "builtin:mesh",
        new BuiltinMeshLoader(),
    );
    assetLoaderRegistry.Register(
        "image:texture",
        new ImageTextureLoader(),
    );
    assetLoaderRegistry.Register(
        "basic:material",
        new MaterialLoader(),
    );

    const assetManager = new AssetManager(
        assetCatalog,
        assetLoaderRegistry,
        memoryTracker,
    );

    return {
        catalog: assetCatalog,
        loaderRegistry: assetLoaderRegistry,
        manager: assetManager,
    };
}

function CreateSceneManager({ renderer, inputManager, assetManager }) {
    const componentRegistry = CreateSceneComponentRegistry();
    const sceneLoader = new SceneLoader(componentRegistry);

    return new SceneManager(
        sceneLoader,
        (url, assetScope) => ({
            systems: [
                {
                    phase: SystemPhase.FixedUpdate,
                    system: new TransformSnapshotSystem(),
                },
                {
                    phase: SystemPhase.FixedUpdate,
                    system: new AngularVelocitySystem(),
                },
                {
                    phase: SystemPhase.FixedUpdate,
                    system: new CameraControlSystem(),
                },
                {
                    phase: SystemPhase.PrepareRender,
                    system: new TransformHierarchySystem(),
                },
                {
                    phase: SystemPhase.PrepareRender,
                    system: new RenderSystem(renderer),
                },
            ],
            services: {
                input: inputManager,
                ResolveMeshHandle: (meshAssetId) =>
                    assetScope.GetHandleRequired(meshAssetId),
                ResolveMaterialHandle: (materialAssetId) =>
                    assetScope.GetHandleRequired(materialAssetId),
            },
        }),
        () => new AssetScope(assetManager),
    );
}

export async function StartBrowserApplication({
    canvas,
    status,
    profiler = null,
    memoryTracker = null,
}) {
    let platform;
    let inputSource;
    let inputManager;
    let renderer;
    let engine;
    let sceneManager;
    let hotReloadClient;
    let disposePromise = null;

    async function Dispose() {
        if (disposePromise) {
            return disposePromise;
        }

        disposePromise = (async () => {
            engine?.Stop();
            inputSource?.Stop();
            hotReloadClient?.Dispose();

            try {
                await sceneManager?.Dispose();
            } catch (cleanupError) {
                AstralLogger.Error("Scene cleanup failed.", cleanupError);
            }

            try {
                renderer?.Shutdown?.();
            } catch (cleanupError) {
                AstralLogger.Error("Renderer cleanup failed.", cleanupError);
            }

            platform?.Stop();
        })();

        return disposePromise;
    }

    try {
        platform = new BrowserPlatform(canvas);
        platform.Start();

        renderer = new WebGPURenderer(
            platform.Canvas,
            memoryTracker,
            profiler,
        );
        await renderer.Initialize();

        const inputMapResponse = await FetchRequiredResponse(
            "/assets/input/default.input-map.json",
            "input action map",
        );

        inputSource = new BrowserInputSource(platform.Canvas);
        inputManager = new InputManager(
            inputSource,
            await inputMapResponse.json(),
        );

        const assetRuntime = await CreateAssetRuntime(memoryTracker);
        sceneManager = CreateSceneManager({
            renderer,
            inputManager,
            assetManager: assetRuntime.manager,
        });

        await sceneManager.LoadScene("/assets/scenes/main.scene.json");

        hotReloadClient = new HotReloadClient(
            assetRuntime,
            sceneManager,
        );
        hotReloadClient.Connect();
        inputSource.Start();

        engine = new Engine(
            renderer,
            (deltaTime, elapsedTime, diagnostics) => {
                inputManager.Update();
                sceneManager.FixedUpdate(
                    deltaTime,
                    elapsedTime,
                    diagnostics,
                );
            },
            (interpolationAlpha, diagnostics) => {
                hotReloadClient.CommitAtFrameBoundary();

                sceneManager.PrepareRender(
                    interpolationAlpha,
                    platform.Canvas.width / platform.Canvas.height,
                    diagnostics,
                );
            },
            { profiler, memoryTracker },
        );
        engine.Start();

        AstralLogger.Info("Scene loaded and WebGPU ready.", {
            sceneName: sceneManager.ActiveScene.Name,
            canvasWidth: platform.Canvas.width,
            canvasHeight: platform.Canvas.height,
        });

        if (status) {
            status.textContent = "Scene loaded. WebGPU ready.";
        }

        return {
            SceneManager: sceneManager,
            Renderer: renderer,
            GetAssetCatalog: () => assetRuntime.catalog,
            Dispose,
        };
    } catch (error) {
        await Dispose();
        throw error;
    }
}
