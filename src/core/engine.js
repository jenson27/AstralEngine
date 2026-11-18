//Engine lifecycle management and frame updates for the Astral Engine, ensuring smooth rendering and update cycles with error handling and logging.

import { AstralLogger } from "../diagnostics/logger.js";
import { ProfileScope } from "../diagnostics/profiling/profiler.js";

export class Engine {
    constructor(
        renderer,
        fixedUpdateCallback = () => {},
        prepareRenderCallback = () => {},
        { profiler = null, memoryTracker = null } = {},
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

        if (
            profiler !== null &&
            (typeof profiler.BeginFrame !== "function" ||
                typeof profiler.EndFrame !== "function" ||
                typeof profiler.BeginScope !== "function" ||
                typeof profiler.EndScope !== "function" ||
                typeof profiler.RecordFrameMetric !== "function")
        ) {
            throw new TypeError("Engine profiler does not have the required API.");
        }

        if (
            memoryTracker !== null &&
            (typeof memoryTracker.BeginFrame !== "function" ||
                typeof memoryTracker.EndFrame !== "function")
        ) {
            throw new TypeError("Engine memory tracker does not have the required API.");
        }

        this._renderer = renderer;
        this._fixedUpdateCallback = fixedUpdateCallback;
        this._prepareRenderCallback = prepareRenderCallback;
        this._profiler = profiler;
        this._memoryTracker = memoryTracker;
        this._diagnosticsContext = Object.freeze({ profiler, memoryTracker });
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
        this._frameNumber = 0;
        this._fixedStepsThisFrame = 0;
        this._droppedTimeThisFrame = 0;
        this._interpolationAlphaThisFrame = 0;
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

        const frameNumber = this._frameNumber;
        this._frameNumber += 1;
        this._fixedStepsThisFrame = 0;
        this._droppedTimeThisFrame = 0;

        this._profiler?.BeginFrame(frameNumber);
        this._memoryTracker?.BeginFrame(frameNumber);

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
            this._profiler?.RecordFrameMetric(
                "frame.deltaMs",
                measuredFrameDeltaTime * 1000,
            );
            this._profiler?.RecordFrameMetric(
                "frame.clampedDeltaMs",
                frameDeltaTime * 1000,
            );

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
        } finally {
            this._profiler?.RecordFrameMetric(
                "simulation.fixedSteps",
                this._fixedStepsThisFrame,
            );
            this._profiler?.RecordFrameMetric(
                "simulation.droppedTimeMs",
                this._droppedTimeThisFrame * 1000,
            );
            this._profiler?.RecordFrameMetric(
                "render.interpolationAlpha",
                this._interpolationAlphaThisFrame,
            );
            this._profiler?.EndFrame();
            this._memoryTracker?.EndFrame();
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
            ProfileScope(
                this._profiler,
                "Engine.FixedUpdate",
                () =>
                    this._fixedUpdateCallback(
                        this._fixedDeltaTime,
                        this._elapsedTime,
                        this._diagnosticsContext,
                    ),
                "phase",
            );

            fixedStepCount += 1;
            this._fixedStepsThisFrame = fixedStepCount;

            if (
                !this._isRunning ||
                runGeneration !== this._runGeneration
            ) {
                return false;
            }

            this._accumulator -= this._fixedDeltaTime;
        }

        if (
            fixedStepCount === this._maxFixedStepsPerFrame &&
            this._accumulator >= this._fixedDeltaTime
        ) {
            if (
                !this._DropExcessFixedUpdateTime(
                    fixedStepCount,
                    measuredFrameDeltaTime,
                    frameDeltaTime,
                    runGeneration,
                )
            ) {
                return false;
            }
        }

        return (
            this._isRunning &&
            runGeneration === this._runGeneration
        );
    }

    _DropExcessFixedUpdateTime(
        fixedStepCount,
        measuredFrameDeltaTime,
        frameDeltaTime,
        runGeneration,
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

        const accumulatorBeforeDropSeconds = this._accumulator;
        const accumulatorAfterDropSeconds =
            accumulatorBeforeDropSeconds % this._fixedDeltaTime;
        this._droppedTimeThisFrame +=
            accumulatorBeforeDropSeconds - accumulatorAfterDropSeconds;
        this._accumulator = accumulatorAfterDropSeconds;
        return true;
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
        this._interpolationAlphaThisFrame = interpolationAlpha;

        ProfileScope(
            this._profiler,
            "Engine.PrepareRender",
            () =>
                this._prepareRenderCallback(
                    interpolationAlpha,
                    this._diagnosticsContext,
                ),
            "phase",
        );

        if (
            !this._isRunning ||
            runGeneration !== this._runGeneration
        ) {
            return false;
        }

        ProfileScope(
            this._profiler,
            "Engine.Render",
            () => this._renderer.Render(),
            "phase",
        );
        return (
            this._isRunning &&
            runGeneration === this._runGeneration
        );
    }
}
