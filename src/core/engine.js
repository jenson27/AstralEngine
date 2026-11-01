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
        this._runGeneration = 0;
    }

    get IsRunning() {
        return this._isRunning;
    }

    Start() {
        if (this._isRunning) {
            return;
        }

        this._isRunning = true;
        this._runGeneration += 1;
        this._previousFrameTime = null;
        this._accumulator = 0;
        this._ScheduleFrame();
    }

    // Schedule the next animation frame if the engine is running and no frame is currently scheduled.
    _ScheduleFrame() {
        if (!this._isRunning || this._animationFrameId !== null) {
            return;
        }

        const runGeneration = this._runGeneration;
        this._animationFrameId = requestAnimationFrame((timestamp) =>
            this._Frame(timestamp, runGeneration),
        );
    }

    Stop() {
        if (!this._isRunning) {
            return;
        }

        this._isRunning = false;
        this._runGeneration += 1;

        if (this._animationFrameId !== null) {
            cancelAnimationFrame(this._animationFrameId);
        }

        this._animationFrameId = null;
        this._previousFrameTime = null;
        this._accumulator = 0;
    }

    // Handle a frame, run fixed updates, prepare rendering, and handle errors.
    _Frame(timestamp, runGeneration) {
        if (
            !this._isRunning ||
            runGeneration !== this._runGeneration
        ) {
            return;
        }

        this._animationFrameId = null;

        const currentTime = timestamp / 1000;
        const measuredFrameDeltaTime =
            this._previousFrameTime === null
                ? 0
                : Math.max(0, currentTime - this._previousFrameTime);
        const frameDeltaTime =
            Math.min(measuredFrameDeltaTime, this._maxFrameDeltaTime);

        this._previousFrameTime = currentTime;
        this._accumulator += frameDeltaTime;

        try {
            if (
                !this._RunFixedUpdates(
                    measuredFrameDeltaTime,
                    frameDeltaTime,
                    runGeneration,
                )
            ) {
                return;
            }

            if (!this._PrepareAndRender(runGeneration)) {
                return;
            }
        } catch (error) {
            this.Stop();
            AstralLogger.Error("Engine frame failed.", error);
            return;
        }

        this._ScheduleFrame();
    }

    _RunFixedUpdates(
        measuredFrameDeltaTime,
        frameDeltaTime,
        runGeneration,
    ) {
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

            if (
                !this._isRunning ||
                runGeneration !== this._runGeneration
            ) {
                return false;
            }

            this._accumulator -= this._fixedDeltaTime;
            fixedStepCount += 1;
        }

        if (
            fixedStepCount === this._maxFixedStepsPerFrame &&
            this._accumulator >= this._fixedDeltaTime
        ) {
            this._WarnAboutDroppedTime(
                fixedStepCount,
                measuredFrameDeltaTime,
                frameDeltaTime,
            );

            if (
                !this._isRunning ||
                runGeneration !== this._runGeneration
            ) {
                return false;
            }

            this._accumulator %= this._fixedDeltaTime;
        }

        return (
            this._isRunning &&
            runGeneration === this._runGeneration
        );
    }

    _WarnAboutDroppedTime(
        fixedStepCount,
        measuredFrameDeltaTime,
        frameDeltaTime,
    ) {
        const currentTimeMs = performance.now();

        if (currentTimeMs - this._lastStepLimitWarningTime < 5000) {
            return;
        }

        this._lastStepLimitWarningTime = currentTimeMs;

        const accumulatorBeforeDropSeconds = this._accumulator;
        const accumulatorAfterDropSeconds =
            accumulatorBeforeDropSeconds % this._fixedDeltaTime;
        const droppedTimeSeconds =
            accumulatorBeforeDropSeconds - accumulatorAfterDropSeconds;
        const droppedSteps = Math.round(
            droppedTimeSeconds / this._fixedDeltaTime,
        );

        AstralLogger.Warn(
            "Engine dropped simulation time after reaching the fixed update step limit.",
            {
                measuredFrameDeltaTimeSeconds: measuredFrameDeltaTime,
                appliedFrameDeltaTimeSeconds: frameDeltaTime,
                frameDeltaWasClamped:
                    measuredFrameDeltaTime > frameDeltaTime,
                fixedSteps: fixedStepCount,
                maxFixedStepsPerFrame: this._maxFixedStepsPerFrame,
                fixedDeltaTimeSeconds: this._fixedDeltaTime,
                accumulatorBeforeDropSeconds,
                droppedSteps,
                droppedTimeSeconds,
                accumulatorAfterDropSeconds,
                elapsedTimeSeconds: this._elapsedTime,
            },
        );
    }

    _PrepareAndRender(runGeneration) {
        const interpolationAlpha =
            this._accumulator / this._fixedDeltaTime;

        this._prepareRenderCallback(interpolationAlpha);

        if (
            !this._isRunning ||
            runGeneration !== this._runGeneration
        ) {
            return false;
        }

        this._renderer.Render();
        return (
            this._isRunning &&
            runGeneration === this._runGeneration
        );
    }
}
