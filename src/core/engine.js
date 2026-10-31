//Engine lifecycle management and frame updates for the Astral Engine, ensuring smooth rendering and update cycles with error handling and logging.

import { AstralLogger } from "../diagnostics/logger.js";

export class Engine {
    constructor(
        renderer,
        fixedUpdateCallback = () => {},
        prepareRenderCallback = () => {},
    ) {
        if (!renderer || typeof renderer.Render !== "function") {
            throw new TypeError(
                "Engine requires a renderer with a Render method.",
            );
        }

        if (typeof fixedUpdateCallback !== "function") {
            throw new TypeError(
                "Engine fixed update callback must be a function.",
            );
        }

        if (typeof prepareRenderCallback !== "function") {
            throw new TypeError(
                "Engine render preparation callback must be a function.",
            );
        }

        this._renderer = renderer;
        this._fixedUpdateCallback = fixedUpdateCallback;
        this._prepareRenderCallback = prepareRenderCallback;
        this._isRunning = false;
        this._animationFrameId = null;
        this._previousFrameTime = null;
        this._elapsedTime = 0;
        this._fixedDeltaTime = 1 / 60;
        this._maxFrameDeltaTime = 0.1;
        this._maxFixedStepsPerFrame = 5;
        this._accumulator = 0;
        this._lastStepLimitWarningTime = -Infinity;
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
        this._accumulator = 0;
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
        this._accumulator = 0;
    }

    // Handle a frame, run fixed updates, prepare rendering, and handle errors.
    _Frame(timestamp) {
        this._animationFrameId = null;

        if (!this._isRunning) {
            return;
        }

        const currentTime = timestamp / 1000;
        const frameDeltaTime =
            this._previousFrameTime === null
                ? 0
                : Math.min(
                      currentTime - this._previousFrameTime,
                      this._maxFrameDeltaTime,
                  );

        this._previousFrameTime = currentTime;
        this._accumulator += frameDeltaTime;

        try {
            let fixedStepCount = 0;

            while (
                this._accumulator >= this._fixedDeltaTime &&
                fixedStepCount < this._maxFixedStepsPerFrame
            ) {
                this._elapsedTime += this._fixedDeltaTime;
                this._fixedUpdateCallback(
                    this._fixedDeltaTime,
                    this._elapsedTime,
                );

                if (!this._isRunning) {
                    return;
                }

                this._accumulator -= this._fixedDeltaTime;
                fixedStepCount += 1;
            }

            if (
                fixedStepCount === this._maxFixedStepsPerFrame &&
                this._accumulator >= this._fixedDeltaTime
            ) {
                const currentTimeMs = performance.now();

                if (currentTimeMs - this._lastStepLimitWarningTime >= 5000) {
                    this._lastStepLimitWarningTime = currentTimeMs;

                    const droppedTime =
                        this._accumulator -
                        (this._accumulator % this._fixedDeltaTime);

                    AstralLogger.Warn(
                        "Engine reached the fixed update step limit and dropped simulation time.",
                        {
                            fixedSteps: fixedStepCount,
                            droppedTimeSeconds: droppedTime,
                        },
                    );
                }

                this._accumulator %= this._fixedDeltaTime;
            }

            if (!this._isRunning) {
                return;
            }

            const interpolationAlpha =
                this._accumulator / this._fixedDeltaTime;

            this._prepareRenderCallback(interpolationAlpha);

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
