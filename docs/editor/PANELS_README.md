# Editor Panels

## Purpose

`EditorShell` registers and mounts editor panels in the browser editor's left and bottom docks. Each panel owns its view and releases its event listeners or timers through `Dispose()`. The shell does not create engine services; `src/editor/main.js` passes those services into panel factories. See [Logging](../diagnostics/LOGGING_README.md), [Profiler](../diagnostics/PROFILER_README.md), and [Memory Tracker](../diagnostics/MEMORY_TRACKER_README.md).

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `EditorShell.RegisterPanel()` | Registers a panel ID, title, dock, and factory before mounting |
| `EditorShell.Mount()` | Creates panel elements and calls each registered factory |
| `EditorShell.Dispose()` | Disposes mounted panels and removes their elements |
| `OnShow()` / `OnHide()` | Start or stop panel work when the shell changes panel visibility |
| `ConsolePanel` | Displays and filters recent log entries |
| `ProfilerPanel` | Displays CPU frames and scopes, async spans, metrics, and available GPU timings |
| `MemoryTrackerPanel` | Displays tracked resources, complete frame totals, retained event details, snapshots, and browser samples |
| `SceneHierarchyPanel` | Displays the active scene's entity hierarchy |
| `BuildSnapshotComparisonModel()` | Applies an owner filter to a snapshot comparison |
| `diagnostic-panel-utils.js` | Provides shared frame, table, byte-formatting, and SVG helpers |
| `src/editor/main.js` | Creates diagnostics services and registers the built-in panels |

## Panel registration and lifecycle

- Panel IDs and titles must be non-empty strings
- `dock` accepts `left` or `bottom`; it defaults to `bottom`
- `create` must be a function and must return an object with `Dispose()`
- Duplicate IDs, unsupported docks, and registration after mounting throw errors
- `Mount(context)` creates each panel and passes the same context to its factory
- If mounting fails, the shell disposes panels already created and rethrows the original error
- `Dispose()` calls panel `Dispose()` methods in reverse mount order and removes their elements
- Optional `OnShow()` and `OnHide()` hooks run when a panel becomes visible or hidden
- The left dock shows its registered panel directly; bottom dock panels use tabs
- Bottom tabs support click, left/right arrow, Home, and End keys
- Dock splitters support pointer resizing and keyboard resizing

## Built-in panels

- `console` uses `AstralLogger`; it shows up to 2,000 entries and supports level and text filters
- Clearing the console panel clears its displayed entries; it does not clear logger history
- `profiler` uses `Profiler` and the renderer; it shows CPU timings and GPU timing availability
- The profiler and memory panels refresh once per second while visible
- Async spans show elapsed time across frames; they are not CPU time
- GPU timestamp availability refreshes when the renderer loses timestamp-query resources
- `memory-tracker` uses `MemoryTracker`; it shows explicitly tracked resources and their supplied size estimates
- Memory totals include events whose detail rows were dropped at the per-frame event limit
- The memory owner filter applies to live totals and complete frame totals
- The memory panel can capture and compare snapshots and request a browser memory sample
- `hierarchy` uses `SceneManager`; it displays the active scene's entities and parent-child links
- The hierarchy panel polls while visible and skips DOM rebuilds when scene revisions are unchanged
- Each panel stops its timers and removes its listeners in `Dispose()`
- If `pagehide` occurs during application startup, the editor disposes the application when startup resolves instead of mounting panels

## Current scope

- Built-in panels are registered in `src/editor/main.js`
- Panel definitions must be registered before `EditorShell.Mount()`
- Panels are browser DOM views; they do not own the engine, scene, or diagnostic service

## Source

- `src/editor/ui/editor-shell.js`
- `src/editor/main.js`
- `src/editor/panels/console-panel.js`
- `src/editor/panels/profiler-panel.js`
- `src/editor/panels/memory-tracker-panel.js`
- `src/editor/panels/scene-hierarchy-panel.js`
- `src/editor/panels/snapshot-comparison-model.js`
- `src/editor/panels/diagnostic-panel-utils.js`
