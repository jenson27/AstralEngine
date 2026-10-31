// This file is the entry point for the browser platform.
// It initializes the platform and starts the application.

import { BrowserPlatform } from "./platform/browser-platform.js";
import { WebGPURenderer } from "./graphics/webgpu-renderer.js";
import { Engine } from "./core/engine.js";
import { AstralLogger } from "./diagnostics/logger.js";
import { Transform } from "./components/transform.js";
import { Camera } from "./components/graphics/camera.js";
import { CreateCubeMesh } from "./graphics/primitives/cube.js";
import { EntityManager } from "./core/ecs/entity-manager.js";
import { CommandBuffer } from "./core/ecs/command-buffer.js";
import { AngularVelocity } from "./components/angular-velocity.js";
import { AngularVelocitySystem } from "./systems/angular-velocity-system.js";
import { MeshRenderer } from "./components/graphics/mesh-renderer.js";
import { RenderSystem } from "./systems/render-system.js";

const canvas = document.getElementById("game-canvas");
const status = document.getElementById("engine-status");

async function StartApplication() {
    let platform;
    let renderer;
    let engine;

    try {
        platform = new BrowserPlatform(canvas);
        platform.Start();

        renderer = new WebGPURenderer(platform.Canvas);
        await renderer.Initialize();

        // Start the engine loop after the renderer is ready.
        const entityManager = new EntityManager();
        const commandBuffer = new CommandBuffer();
        const angularVelocitySystem = new AngularVelocitySystem();
        const updateSystems = [angularVelocitySystem];
        const renderSystem = new RenderSystem(renderer);
        const cubeMesh = CreateCubeMesh();

        const firstCubeEntity = entityManager.CreateEntity();
        const firstCubeTransform = new Transform();
        firstCubeTransform.position[0] = -0.8;

        entityManager.AddComponent(
            firstCubeEntity,
            Transform,
            firstCubeTransform,
        );
        entityManager.AddComponent(
            firstCubeEntity,
            AngularVelocity,
            new AngularVelocity(0.6, 1, 0),
        );
        entityManager.AddComponent(
            firstCubeEntity,
            MeshRenderer,
            new MeshRenderer(cubeMesh),
        );

        const secondCubeEntity = entityManager.CreateEntity();
        const secondCubeTransform = new Transform();
        secondCubeTransform.position[0] = 0.8;

        entityManager.AddComponent(
            secondCubeEntity,
            Transform,
            secondCubeTransform,
        );
        entityManager.AddComponent(
            secondCubeEntity,
            AngularVelocity,
            new AngularVelocity(-0.4, -0.8, 0),
        );
        entityManager.AddComponent(
            secondCubeEntity,
            MeshRenderer,
            new MeshRenderer(cubeMesh),
        );

        const cameraEntity = entityManager.CreateEntity();
        const cameraTransform = new Transform();
        cameraTransform.position[2] = 3;

        entityManager.AddComponent(cameraEntity, Transform, cameraTransform);
        entityManager.AddComponent(cameraEntity, Camera, new Camera());

        engine = new Engine(
            renderer,
            (deltaTime) => {
                for (const system of updateSystems) {
                    system.Update(entityManager, deltaTime, commandBuffer);
                }

                commandBuffer.Flush(entityManager);
                entityManager.DispatchComponentRemovals();
            },
            () => {
                renderSystem.Prepare(
                    entityManager,
                    cameraEntity,
                    platform.Canvas.width / platform.Canvas.height,
                );
            },
        );
        engine.Start();

        AstralLogger.Info("WebGPU ready. Canvas cleared.", {
            canvasWidth: platform.Canvas.width,
            canvasHeight: platform.Canvas.height,
        });

        if (status) {
            status.textContent = "WebGPU ready. Canvas cleared.";
        }
    } catch (error) {
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
