# Engine

## Purpose

`Engine` runs the browser animation-frame loop and separates fixed simulation updates from render preparation. It owns timing state, but it does not create scenes or register systems; `main.js` wires those parts together. See [Scene Management](SCENE_MANAGEMENT_README.md) for scene updates.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `Engine` | Starts and stops the frame loop, runs fixed updates, prepares rendering, and calls the renderer |
| `SystemPhase` | Names the `FixedUpdate` and `PrepareRender` phases |
| `SystemScheduler` | Adds systems, lists registered systems, and runs them in phase order |

## Ownership

- `Engine` keeps references to the renderer and callback functions supplied by its caller
- The caller owns the renderer and must initialize and shut it down
- `SystemScheduler` stores systems in insertion order within each phase
- The scene owns its scheduler and disposes initialized systems

## Frame timing

- `Engine` uses `requestAnimationFrame()` and a fixed step of `1 / 60` seconds
- It clamps each frame's accumulated time to `0.1` seconds
- It runs at most five fixed updates in one frame
- If more fixed time remains, it drops whole excess steps, keeps the fractional remainder, and logs a warning at most once every five seconds
- The render interpolation alpha is the remaining accumulator divided by the fixed step
- A stopped or restarted run ignores callbacks from an older animation-frame sequence

## Engine API

| Member | Behaviour |
| --- | --- |
| `Engine(renderer, fixedUpdateCallback, prepareRenderCallback)` | Requires a renderer with `Render()` and two callback functions |
| `IsRunning` | Returns whether the loop is active |
| `Start()` | Starts the loop; repeated calls while running do nothing |
| `Stop()` | Cancels the scheduled frame and clears timing accumulation; repeated calls do nothing |

- The fixed callback receives `(deltaTime, elapsedTime)` for each fixed step
- The preparation callback receives `interpolationAlpha` once before each render
- A callback or renderer error stops the loop and is logged

## System scheduling

| Member | Behaviour |
| --- | --- |
| `SystemScheduler.AddSystem(phase, system)` | Adds a system before the scheduler is running |
| `SystemScheduler.GetSystems()` | Returns registered systems once each, in phase and insertion order |
| `SystemScheduler.Run(phase, scene, context)` | Calls `FixedUpdate(scene, context)` or `PrepareRender(scene, context)` in order |

- A system must implement the method required by its phase
- Unknown phases, duplicate registration in one phase, and recursive runs throw
- A system cannot be added while a phase is running
- If a system throws, the run stops at that system; the scheduler clears its running flag in `finally`

## Frame flow

1. `Engine._Frame()` adds the clamped frame time to the accumulator
2. The engine invokes the fixed callback while a full fixed step remains, up to the step limit
3. The engine computes interpolation alpha and invokes the preparation callback
4. The renderer's `Render()` method draws the prepared frame
5. The engine schedules the next animation frame

## Current scope

- Timing uses browser animation-frame APIs and is not a headless or server loop
- The engine does not run a separate variable-rate update callback
- WebGPU setup and application startup belong to `main.js` and `WebGPURenderer`

## Source

- `src/core/engine.js`
- `src/core/scene/system-scheduler.js`
- `src/main.js`
