# Memory Tracker

## Purpose

`MemoryTracker` records memory estimates for resources that engine code explicitly tracks. It stores per-frame allocation and release events, live resource totals, and bounded resource snapshots. It does not inspect or attribute the full JavaScript heap; browser memory sampling is a separate optional measurement. See [Profiler](PROFILER_README.md) and [Graphics](../graphics/GRAPHICS_README.md) for related diagnostics and tracked resources.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `MemoryTracker` | Tracks resource estimates, frame events, snapshots, and browser memory samples |
| `MemoryTracker.Revision` / `ResourceRevision` / `CurrentOwner` | Expose data revisions and the active owner |
| `MemoryTracker.BeginFrame()` / `EndFrame()` | Capture bounded resource events for one engine frame |
| `MemoryTracker.BeginOwnerScope()` / `EndOwnerScope()` | Set the default owner for nested resource operations |
| `MemoryTracker.TrackResource()` / `ReleaseResource()` | Add and remove a tracked resource |
| `MemoryTracker.GetLiveResources()` / `GetLiveUsage()` | Read current tracked resources and totals |
| `MemoryTracker.GetFrames()` | Return completed frame records from oldest to newest |
| `MemoryTracker.TakeSnapshot()` / `GetSnapshots()` | Capture and list retained resource snapshots |
| `MemoryTracker.CompareSnapshots()` | Compare two retained snapshots |
| `MemoryTracker.SampleBrowserMemory()` | Request a page-wide memory sample when the browser supports it |

## Resource tracking

- `TrackResource()` requires a non-empty label, type, and category
- `bytes` must be a non-negative safe integer; zero is valid
- `owner` defaults to the active owner scope, then to `Unattributed`
- `estimated` identifies resource sizes that are estimates
- `TrackResource()` returns the new resource ID
- `ReleaseResource()` returns `false` for a null, unknown, or already released ID
- Releasing a known ID removes it from live usage and returns `true`
- Resource changes outside an active frame update live usage but do not create frame events
- The scheduler sets each system name as the owner while that system runs

## Frame records and capacity

- Frame numbers must be non-negative safe integers
- Starting a second tracking frame before ending the first throws an error
- `EndFrame()` returns `null` when there is no active tracking frame
- Completed frame records include starting and ending bytes by owner, live bytes, complete allocation and release totals, owner changes, retained event details, and dropped event count
- The default frame capacity is 600; new frames overwrite the oldest frame
- The default event limit is 1,024 per frame; excess event details are dropped and increase `droppedEventCount`
- Event totals and `ownerFilterTotals` include dropped events; only the detailed `events` list is capped
- `GetLiveUsage()` returns cached byte totals and resource counts by owner
- Returned completed frame records are frozen

## Owner scopes

- `BeginOwnerScope(owner)` requires a non-empty string and returns a token
- Nested scopes restore the previous owner when ended
- Owner scopes must end in reverse start order; invalid order throws an error
- Null owner-scope tokens are ignored

## Snapshots and comparisons

- `TakeSnapshot(label)` captures the current live resources; the default label is `Snapshot`
- Snapshot labels must be non-empty strings
- Snapshots have increasing IDs and contain frozen resource and owner totals
- The default snapshot capacity is 12; creating another removes the oldest snapshot
- `CompareSnapshots()` reports added and released resources, byte totals, and per-owner changes
- Comparing a snapshot that is no longer retained throws an error

## Browser memory sampling

- `SampleBrowserMemory()` uses `performance.measureUserAgentSpecificMemory` when available
- A supported result includes page-wide bytes and browser breakdown data
- Unsupported APIs and sampling errors return `{ supported: false, reason }`
- Browser samples do not identify engine owners or update tracked resource totals

## Current scope

- Tracked totals include only resources passed to `TrackResource()`
- Resource byte sizes are supplied by callers and may be estimates
- Browser memory sampling is browser-dependent and may be unavailable

## Source

- `src/diagnostics/profiling/memory-tracker.js`
- `src/core/engine.js`
- `src/core/scene/system-scheduler.js`
