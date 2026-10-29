// This file is the entry point for the browser platform.
// It initializes the platform and starts the application.

import { BrowserPlatform } from "./platform/browser-platform.js";
import { WebGPURenderer } from "./graphics/webgpu-renderer.js";
import { AstralLogger } from "./core/logger.js";

const canvas = document.getElementById("game-canvas");
const status = document.getElementById("engine-status");

async function StartApplication() {
    let platform;
    let renderer;

    try {
        platform = new BrowserPlatform(canvas);
        platform.Start();

        renderer = new WebGPURenderer(platform.Canvas);
        await renderer.Initialize();

        // Temporarily render a single frame to clear the canvas with a specified color.
        function RenderFrame() {
            renderer.Render();
            requestAnimationFrame(RenderFrame);
        }

        RenderFrame();
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
