# Asset Manager

## Purpose

`AssetManager` loads assets through registered loaders and tracks how many active users hold each asset. It shares concurrent loads and keeps dependencies leased for as long as their parent assets are in use. It does not define asset metadata or render assets. See [Asset Registry](ASSET_REGISTRY_README.md), [Scene Management](SCENE_MANAGEMENT_README.md), and [Graphics](../graphics/GRAPHICS_README.md) for related systems.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `AssetManager.constructor()` | Validates and stores an asset catalog and loader registry. |
| `AssetManager.Acquire()` | Loads an asset and returns a reference-counted lease. |
| `AssetManager.GetState()` | Returns an asset's current load state. |
| `AssetLease.Asset` / `Release()` | Provides the loaded asset and releases one reference. |
| `AssetScope.constructor()` | Validates and stores an asset manager. |
| `AssetScope.Acquire()` | Acquires an asset once for a scope and shares the result within that scope. |
| `AssetScope.Get()` / `GetRequired()` | Reads an asset already acquired by the scope. |
| `AssetScope.ReleaseAll()` | Releases all assets held by the scope. |
| Loader `Load()` / optional `Release()` | Creates an asset and releases loader-owned resources. |

## Ownership

- `AssetManager` stores load entries and states in maps keyed by asset ID.
- Each acquisition returns an `AssetLease` that holds one reference to a loaded asset.
- The `Asset` getter throws after its lease has been released.
- Releasing the same lease more than once has no further effect after the first call.
- `AssetScope` owns one lease for each distinct asset ID it acquires. `ReleaseAll()` releases those leases.
- A loader owns the resources it creates until its `Release()` method runs.
- Callers must not use an asset after its final lease has been released.
- `WebGPURenderer` owns GPU buffers and textures separately from CPU-side assets. See [Graphics](../graphics/GRAPHICS_README.md).

## Acquisition and dependencies

1. `AssetManager.Acquire()` rejects a blank or non-string asset ID.
2. The manager checks the dependency graph for cycles before any loader runs.
3. It finds or creates a loading entry. Concurrent acquisitions share the same load promise.
4. The manager acquires each declared dependency and passes a frozen loader context with a `GetDependency()` function.
5. `GetDependency()` returns only declared dependencies. It throws for an undeclared dependency.
6. The loader's `Load(descriptor, context)` creates the asset. Returning `null` or `undefined` is an error.
7. Each successful acquisition returns a separate `AssetLease` for the shared asset.
8. If loading fails, the manager sets the state to `failed` and releases acquired dependency leases. A later acquisition can retry.

- Shared dependencies load once while their references remain active.
- A parent keeps its dependencies leased until the parent asset is released.
- A failed dependency or loader call fails the parent load.
- Dependency cleanup errors are combined with the load error in an `AggregateError`.
- The manager requires an asset catalog and loader registry with `GetRequired()` methods. Unknown asset and loader IDs fail during lookup.

## Release and state

- `GetState()` returns `unloaded`, `loading`, `loaded`, `releasing`, or `failed`.
- The final lease release changes the state to `releasing`.
- The manager calls the loader's optional `Release()` method, then releases dependency leases.
- After cleanup, the manager clears the loaded object and sets the state to `unloaded`.
- If a loader or dependency release fails, the manager logs the error and rejects with an `AggregateError`. It still clears the entry.
- A new acquisition waits for an in-progress release before it creates a new load entry.

## Asset scopes

- A scope must be open to call `Acquire()`, `Get()`, or `GetRequired()`.
- Repeated acquisitions of the same asset ID in one scope return the same asset and do not create extra scope leases.
- Concurrent acquisitions of the same ID in one scope share one pending request.
- `Get()` returns `undefined` when the scope has not acquired the ID. `GetRequired()` throws in that case.
- `ReleaseAll()` closes the scope, waits for pending acquisitions, and releases its leases.
- Repeated `ReleaseAll()` calls share the same completion promise. Calls after disposal resolve without releasing again.
- If the scope closes while an acquisition is pending, the new lease is released and that acquisition fails.
- Release failures are collected and reported in an `AggregateError`.
- When configured with a scope factory, `SceneManager` creates a scope for each scene load and releases the previous scope after a successful scene replacement. See [Scene Management](SCENE_MANAGEMENT_README.md).

## Current scope

- Asset metadata is JSON data. Runtime asset objects are created by loaders.
- The manager has no direct reload or eviction API. Releasing the final lease unloads an asset; a later acquisition loads it again.
- The browser startup code registers built-in mesh, image texture, and material loaders. See [Graphics](../graphics/GRAPHICS_README.md).

## Source

- `src/core/assets/asset-manager.js`
- `src/core/assets/asset-scope.js`
- `src/core/scene-manager.js`
