// This file is the entry point for the browser platform.
// It initializes the platform and starts the application.

import { BrowserPlatform } from "./platform/browser-platform.js";
import { WebGPURenderer } from "./graphics/webgpu-renderer.js";
import { Engine } from "./core/engine.js";
import { AstralLogger } from "./diagnostics/logger.js";
import { Transform } from "./components/transform.js";

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
        const transform = new Transform();

        engine = new Engine(renderer, (deltaTime) => {
            transform.rotation[2] += deltaTime;
            renderer.SetModelMatrix(transform.GetModelMatrix());
        });
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
