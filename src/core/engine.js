//Engine lifecycle management and frame updates for the Astral Engine, ensuring smooth rendering and update cycles with error handling and logging.

import { AstralLogger } from "../diagnostics/logger.js";

export class Engine {
    constructor(renderer, updateCallback = () => {}) {
        if (!renderer || typeof renderer.Render !== "function") {
            throw new TypeError(
                "Engine requires a renderer with a Render method.",
            );
        }

        if (typeof updateCallback !== "function") {
            throw new TypeError("Engine update callback must be a function.");
        }

        this._renderer = renderer;
        this._updateCallback = updateCallback;
        this._isRunning = false;
        this._animationFrameId = null;
        this._previousFrameTime = null;
        this._elapsedTime = 0;
    }

    get IsRunning() {
        return this._isRunning;
    }

    Start() {
        if (this._isRunning) {
            return;
        }

        this._isRunning = true;
        this._previousFrameTime = null;
        this._ScheduleFrame();
    }

    // Schedule the next animation frame if the engine is running and no frame is currently scheduled.
    _ScheduleFrame() {
        if (!this._isRunning || this._animationFrameId !== null) {
            return;
        }

        this._animationFrameId = requestAnimationFrame((timestamp) =>
            this._Frame(timestamp),
        );
    }

    Stop() {
        if (!this._isRunning) {
            return;
        }

        this._isRunning = false;

        if (this._animationFrameId !== null) {
            cancelAnimationFrame(this._animationFrameId);
        }

        this._animationFrameId = null;
        this._previousFrameTime = null;
    }

    // Handle a single frame update, including time calculations, invoking the update callback, rendering, and error handling.
    _Frame(timestamp) {
        this._animationFrameId = null;

        if (!this._isRunning) {
            return;
        }

        const currentTime = timestamp / 1000;
        const deltaTime =
            this._previousFrameTime === null
                ? 0
                : Math.min(currentTime - this._previousFrameTime, 0.1);

        this._previousFrameTime = currentTime;
        this._elapsedTime += deltaTime;

        try {
            this._updateCallback(deltaTime, this._elapsedTime);

            if (!this._isRunning) {
                return;
            }

            this._renderer.Render();
        } catch (error) {
            this.Stop();
            AstralLogger.Error("Engine frame failed.", error);
            return;
        }

        this._ScheduleFrame();
    }
}
