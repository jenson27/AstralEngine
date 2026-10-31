# Engine

## Purpose

`Engine` runs fixed updates and renders frames through a supplied renderer. It stores the update callbacks and timing state, but it does not create the renderer or own game systems. See [Entity Manager](ENTITY_MANAGER_README.md) for the ECS that game callbacks can update.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `Engine` | Stores the renderer, callbacks, and frame timing state. |
| `constructor()` | Validates the renderer and callbacks and sets the timing limits. |
| `IsRunning` | Returns whether the frame loop is running. |
| `Start()` | Starts the loop if it is not already running. |
| `Stop()` | Stops the loop and cancels a scheduled frame. |
| `_ScheduleFrame()` | Schedules one browser animation frame while the engine is running. |
| `_Frame()` | Runs fixed updates, prepares rendering, draws a frame, and handles errors. |

## Ownership

- `Engine` stores references to the supplied renderer and callbacks. It does not initialize or shut down the renderer.
- `Engine` owns its frame timing state, including its accumulator and elapsed time.
- The renderer and callbacks remain the responsibility of the caller.

## Frame timing

- `Start()` does nothing when the engine is already running.
- `Stop()` does nothing when the engine is already stopped.
- Starting resets the previous frame timestamp and fixed-step accumulator. It does not reset elapsed time.
- The fixed-update and render-preparation callbacks default to no-op functions when omitted.
- The first frame after start has a delta time of zero.
- Later frame delta time is capped at `0.1` seconds.
- Fixed updates use a step of `1 / 60` seconds. The engine runs at most five fixed steps in one frame.
- If more fixed-step time remains after the five-step limit, the engine drops whole excess steps and keeps the fractional remainder.
- `prepareRenderCallback()` receives an interpolation value between zero and one. The engine does not interpolate object transforms itself.

## Frame flow

1. `_Frame()` converts the browser timestamp to seconds and calculates the capped frame delta.
2. `_Frame()` adds that delta to the fixed-step accumulator.
3. `_Frame()` calls `fixedUpdateCallback(this._fixedDeltaTime, this._elapsedTime)` once per available fixed step, up to the five-step limit.
4. If the callback stops the engine, `_Frame()` returns without preparing or rendering the frame.
5. `_Frame()` calls `prepareRenderCallback(interpolationAlpha)` with the remaining interpolation value.
6. If the callback stops the engine, `_Frame()` returns without rendering.
7. `_Frame()` calls `renderer.Render()`.
8. If an update, preparation, or render call throws, `_Frame()` stops the engine and logs the error through `AstralLogger`.
9. If the engine is still running, `_Frame()` schedules the next frame.

## Design choices and tradeoffs

- **Use fixed updates.** This gives game systems a stable time step, but the engine limits catch-up work and drops excess whole steps to avoid an unbounded update loop.
- **Separate update and render callbacks.** Game systems can update at a fixed rate while rendering can continue once per browser frame. The caller must set up both callbacks.

## Current scope

- The engine uses the browser's `requestAnimationFrame()` and `cancelAnimationFrame()` APIs.
- The timestep and timing limits are fixed in the constructor.
- Pause, resume, and renderer lifecycle management are not implemented.

## Source

- `src/core/engine.js`
- `src/diagnostics/logger.js`
