// This file is the entry point for the browser platform.
// It initializes the platform and starts the application.

import { BrowserPlatform } from "./platform/browser-platform.js";
import { WebGPURenderer } from "./graphics/webgpu-renderer.js";
import { Engine } from "./core/engine.js";
import { AstralLogger } from "./diagnostics/logger.js";
import { AngularVelocitySystem } from "./systems/angular-velocity-system.js";
import { RenderSystem } from "./systems/render-system.js";
import { SceneLoader } from "./core/scene-loader.js";
import { SceneManager } from "./core/scene-manager.js";
import { SystemPhase } from "./core/system-scheduler.js";
import { CreateSceneComponentRegistry } from "./components/register-scene-components.js";
import { AssetCatalog } from "./core/assets/asset-catalog.js";
import { AssetLoaderRegistry } from "./core/assets/asset-loader-registry.js";
import { AssetManager } from "./core/assets/asset-manager.js";
import { AssetScope } from "./core/assets/asset-scope.js";
import { BuiltinMeshLoader } from "./graphics/assets/builtin-mesh-loader.js";
import { ImageTextureLoader } from "./graphics/assets/image-texture-loader.js";
import { MaterialLoader } from "./graphics/assets/material-loader.js";

const canvas = document.getElementById("game-canvas");
const status = document.getElementById("engine-status");

async function StartApplication() {
    let platform;
    let renderer;
    let engine;
    let sceneManager;

    try {
        platform = new BrowserPlatform(canvas);
        platform.Start();

        renderer = new WebGPURenderer(platform.Canvas);
        await renderer.Initialize();

        const manifestResponse = await fetch(
            "/assets/asset-manifest.json",
        );

        if (!manifestResponse.ok) {
            throw new Error(
                "Could not load asset manifest. HTTP " +
                    manifestResponse.status +
                    ".",
            );
        }

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
        );
        const componentRegistry = CreateSceneComponentRegistry();
        const sceneLoader = new SceneLoader(componentRegistry);

        sceneManager = new SceneManager(
            sceneLoader,
            (url, assetScope) => ({
                systems: [
                    {
                        phase: SystemPhase.FixedUpdate,
                        system: new AngularVelocitySystem(),
                    },
                    {
                        phase: SystemPhase.PrepareRender,
                        system: new RenderSystem(renderer),
                    },
                ],
                services: {
                    ResolveMesh: (meshAssetId) =>
                        assetScope.GetRequired(meshAssetId),
                    ResolveMaterial: (materialAssetId) =>
                        assetScope.GetRequired(materialAssetId),
                },
            }),
            () => new AssetScope(assetManager),
        );

        await sceneManager.LoadScene("/assets/scenes/main.scene.json");

        engine = new Engine(
            renderer,
            (deltaTime, elapsedTime) =>
                sceneManager.FixedUpdate(deltaTime, elapsedTime),
            (interpolationAlpha) =>
                sceneManager.PrepareRender(
                    interpolationAlpha,
                    platform.Canvas.width / platform.Canvas.height,
                ),
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
    } catch (error) {
        engine?.Stop();

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
        throw error;
    }
}

StartApplication().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);

    AstralLogger.Error("Startup failed.", error);

    if (status) {
        status.textContent = `Startup failed: ${message}`;
    }
});
