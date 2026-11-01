# Asset Manager

## Purpose

`AssetManager` loads assets through registered loaders and tracks how many active users hold each asset. It shares concurrent loads and keeps dependencies leased for as long as their parent assets are in use. It does not define asset metadata or render assets. See [Asset Registry](ASSET_REGISTRY_README.md), [Scene Management](SCENE_MANAGEMENT_README.md), and [Graphics](../graphics/GRAPHICS_README.md) for related systems.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `AssetManager.constructor()` | Validates and stores an asset catalog and loader registry. |
| `AssetManager.Acquire()` | Loads an asset and returns a reference-counted lease. |
| `AssetManager.GetState()` | Returns an asset's current load state. |
| `AssetManager.GetLoadedAssetIds()` | Returns IDs for entries that are currently loaded. |
| `AssetManager.StageReload()` | Loads replacement objects without changing the current assets. |
| `AssetManager.CommitStagedReload()` | Swaps ready replacements into stable handles and releases old objects. |
| `AssetLease.Asset` / `Release()` | Provides the loaded asset and releases one reference. |
| `AssetLease.Handle` | Returns the lease's stable `AssetHandle`. |
| `AssetHandle.constructor()` | Creates a stable reference for one asset ID. |
| `AssetHandle.AssetId` / `Version` / `Current` | Exposes the asset ID, replacement version, and current asset object. |
| `AssetScope.constructor()` | Validates and stores an asset manager. |
| `AssetScope.Acquire()` | Acquires an asset once for a scope and shares the result within that scope. |
| `AssetScope.Get()` / `GetRequired()` | Reads an asset already acquired by the scope. |
| `AssetScope.ReleaseAll()` | Releases all assets held by the scope. |
| Loader `Load()` / optional `Release()` | Creates an asset and releases loader-owned resources. |
| `HotReloadClient.constructor()` | Validates and stores the asset runtime, scene manager, and hot-reload options. |
| `HotReloadClient.Connect()` | Opens the server's asset-change event stream. |
| `HotReloadClient.CommitAtFrameBoundary()` | Commits a ready asset reload before render preparation. |
| `HotReloadClient.Dispose()` | Closes the event stream and clears pending changes. |

## Ownership

- `AssetManager` stores load entries and states in maps keyed by asset ID.
- Each acquisition returns an `AssetLease` that holds one reference to a loaded asset.
- `AssetLease.Handle` returns the stable `AssetHandle` for that asset. The `Asset` getter reads the handle's current object and throws after its lease has been released.
- `AssetHandle.Current` throws when the asset is not loaded. `Version` increases each time the manager installs an asset object in the handle.
- Components can keep a handle while the manager replaces its current object. The handle does not own the asset's lifetime; leases do.
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

## Hot reload transaction

1. The server watches `assets/` recursively and sends changed paths to `HotReloadClient` through the `/api/hot-reload` event stream.
2. `HotReloadClient` maps changed asset source paths to IDs with `AssetCatalog.GetAssetIdsBySourcePath()`. It queues mapped assets only when their manager state is `loading` or `loaded`.
3. `StageReload(assetIds)` accepts one ID or an array of IDs. It removes duplicate IDs from an array and rejects an empty list, invalid IDs, or another active transaction.
4. The manager waits for in-flight loads, then requires each requested asset to be loaded. It adds loaded dependents to the affected set and stages replacement objects in dependency order.
5. The manager keeps the current asset objects active while staging. New `Acquire()` calls wait until the transaction commits or staging fails.
6. If staging fails, the manager releases staged replacement objects and temporary leases. The existing handles and assets remain active.
7. The engine calls `HotReloadClient.CommitAtFrameBoundary()` in its render-preparation callback, before `SceneManager.PrepareRender()`.
8. `CommitStagedReload()` checks that the current objects have not changed, then synchronously swaps all replacements into their handles. Each handle's `Version` increases.
9. The manager releases old asset objects and temporary leases after the swap. It returns a promise that resolves with the reloaded asset IDs.

- `CommitStagedReload()` returns `null` when no transaction is ready. It throws if the transaction is in an invalid state or an asset changed before commit.
- A cleanup failure after the swap rejects the returned promise with an `AggregateError`. The new assets remain active because the commit already happened.
- If staging cleanup also fails, the staging error and cleanup errors are combined in an `AggregateError`.
- A change to the active scene document reloads that scene. A change to the asset manifest creates a new catalog and manager, then reloads the active scene with that runtime.
- A failed scene or manifest reload leaves the previous active scene and asset runtime in place.

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
- `StageReload()` and `CommitStagedReload()` replace loaded assets. Releasing the final lease unloads an asset; a later acquisition loads it again.
- The development server watches files under `assets/`. Changed asset files trigger reloads only for assets that are loading or loaded. A change to the active scene document or asset manifest also triggers a reload.
- The server does not watch `src/`. JavaScript and WGSL source edits do not trigger hot reload; refresh the browser to load those changes.
- The browser startup code registers built-in mesh, image texture, and material loaders. See [Graphics](../graphics/GRAPHICS_README.md).

## Source

- `src/core/assets/asset-manager.js`
- `src/core/assets/asset-catalog.js`
- `src/core/assets/asset-handle.js`
- `src/core/assets/asset-scope.js`
- `src/core/hot-reload-client.js`
- `src/core/scene-manager.js`
- `src/main.js`
- `server.cjs`
