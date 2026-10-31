// This file is the entry point for the browser platform.
// It initializes the platform and starts the application.

import { BrowserPlatform } from "./platform/browser-platform.js";
import { WebGPURenderer } from "./graphics/webgpu-renderer.js";
import { Engine } from "./core/engine.js";
import { AstralLogger } from "./diagnostics/logger.js";
import { CreateCubeMesh } from "./graphics/primitives/cube.js";
import { AngularVelocitySystem } from "./systems/angular-velocity-system.js";
import { RenderSystem } from "./systems/render-system.js";
import { SceneLoader } from "./core/scene-loader.js";
import { SceneManager } from "./core/scene-manager.js";
import { SystemPhase } from "./core/system-scheduler.js";
import { CreateSceneComponentRegistry } from "./components/register-scene-components.js";

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

        const cubeMesh = CreateCubeMesh();
        const meshes = new Map([["builtin:cube", cubeMesh]]);
        const componentRegistry = CreateSceneComponentRegistry();
        const sceneLoader = new SceneLoader(componentRegistry);
        const resolveMesh = (meshAssetId) => {
            const mesh = meshes.get(meshAssetId);
            if (!mesh) {
                throw new Error("Unknown mesh asset: " + meshAssetId);
            }

            return mesh;
        };

        sceneManager = new SceneManager(sceneLoader, () => ({
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
            services: { ResolveMesh: resolveMesh },
        }));

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
            sceneManager?.Dispose();
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
