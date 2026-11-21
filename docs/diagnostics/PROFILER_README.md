# Profiler

## Purpose

`Profiler` records bounded CPU frame and scope timings, async spans, frame metrics, and optional GPU frame timings. `Engine` starts and ends each frame capture, while `SystemScheduler` records system scopes. It does not instrument arbitrary functions by itself; use the profiling helper functions for that. See [Engine](../core/ENGINE_README.md) and [Memory Tracker](MEMORY_TRACKER_README.md) for related diagnostics.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `ProfilerCaptureVersion` | Identifies the capture record format |
| `Profiler` | Stores bounded frame captures, nested scopes, metrics, and GPU timings |
| `Profiler.IsEnabled` / `CurrentFrameNumber` / `Revision` | Expose capture state and the current frame and revision |
| `Profiler.DroppedAsyncSpanCount` | Reports async spans rejected at the active-span limit |
| `Profiler.SetEnabled()` | Starts or stops capture |
| `Profiler.BeginFrame()` / `EndFrame()` | Start and finish a frame capture |
| `Profiler.BeginScope()` / `EndScope()` | Record synchronous nested work |
| `Profiler.BeginAsyncScope()` / `EndAsyncScope()` | Record async frame slices and spans without nesting them under synchronous scopes |
| `Profiler.RecordFrameMetric()` | Store a named numeric value on the active frame |
| `Profiler.RecordGpuFrameTime()` / `GetGpuFrameTime()` | Store and read GPU timing for a retained frame |
| `Profiler.GetFrames()` | Return completed frames from oldest to newest |
| `Profiler.GetAsyncSpans()` | Return retained and currently running async spans in start-time order |
| `ProfileScope()` / `ProfileFunction()` | Measure synchronous callbacks and functions |
| `ProfileAsyncScope()` / `ProfileAsyncFunction()` | Measure asynchronous callbacks and functions |

## Capture lifecycle

- `BeginFrame(frameNumber)` starts capture when enabled and returns `true`
- A disabled profiler returns `false` without validating the frame number
- Frame numbers must be non-negative safe integers
- Starting a second frame before ending the first throws an error
- `SetEnabled(false)` discards the active frame and synchronous scopes; completed frames remain available
- `SetEnabled(false)` closes active async spans as incomplete
- `EndFrame()` returns `null` when capture is disabled or no frame is active
- Ending a frame closes open scopes as incomplete, freezes the capture records, and stores the frame
- The default frame capacity is 600; adding more frames overwrites the oldest frame

## Scopes and metrics

- Scope names, categories, and metric names must be non-empty strings
- `BeginScope()` returns `null` when capture is disabled, no frame is active, or the per-frame scope limit is reached
- The default scope limit is 2,048; captures count scopes dropped at this limit
- Synchronous scopes must end in reverse start order; invalid order throws an error
- Null or stale scope tokens are ignored
- Async scopes are top-level frame slices, may overlap, and set `isAsync` to `true`
- Async spans are separate records that preserve elapsed time across frames and can include waiting; they are not CPU time
- `EndFrame()` marks an open async frame slice incomplete but keeps its async span running
- `EndAsyncScope()` completes the span and records its ending frame when available
- The default active and completed async span capacities are 256 each
- `BeginAsyncScope()` returns `null` when the active span limit is reached and increments `DroppedAsyncSpanCount`
- Completed spans beyond the retained capacity overwrite the oldest span
- `RecordFrameMetric()` requires a finite number and returns `false` when capture is inactive
- Recording the same metric name again replaces its value for that frame

## GPU timing

- `WebGPURenderer` records GPU frame time when timestamp queries are supported and the profiler is enabled
- GPU results arrive asynchronously and are attached to a frame that is still retained
- `RecordGpuFrameTime()` returns `false` when the frame is no longer in the capture buffer
- GPU timing can be unavailable when the browser or GPU does not support timestamp queries

## Profiling helpers

- `ProfileScope()` measures a synchronous callback and returns its result
- `ProfileFunction()` returns a wrapper that preserves the call receiver and arguments
- `ProfileAsyncScope()` measures an asynchronous operation across frames and returns its resolved result
- `ProfileAsyncFunction()` returns an async wrapper that preserves the call receiver and arguments while measuring across frames
- Each helper ends its scope in `finally`, including when the callback throws or rejects
- Helpers still call the callback when the profiler is `null` or capture is inactive

## Current scope

- CPU timings use `performance.now()`
- Captures contain timing records and numeric metrics; they are not serialized to JSON
- GPU timing depends on WebGPU timestamp-query support

## Source

- `src/diagnostics/profiling/profiler.js`
- `src/core/engine.js`
- `src/core/scene/system-scheduler.js`
- `src/graphics/webgpu-renderer.js`
