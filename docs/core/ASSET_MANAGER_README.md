# Asset Manager

## Purpose

`AssetManager` loads assets through registered loaders, tracks reference-counted leases, and keeps dependency assets alive while their dependents are loaded. It also stages replacements and commits them as a reload transaction. `AssetScope` groups leases for one scene, while `HotReloadClient` coordinates file events and frame-boundary commits. See [Asset Registry](ASSET_REGISTRY_README.md) for descriptors and loader registration.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `AssetManager(assetCatalog, loaderRegistry)` | Loads and releases assets, manages leases, and coordinates reload transactions |
| `AssetDependencyResolver(assetCatalog)` | Validates dependency graphs and orders loaded assets for reload |
| `AssetHandle(assetId)` | Exposes `AssetId`, `Version`, and the current replaceable asset |
| `AssetLease` | Holds access to one asset reference and releases it once |
| `AssetScope(assetManager)` | Groups acquisitions and releases leases for one scene |
| `AssetScope.RetainOnly(assetIds)` | Keeps leases for listed IDs and releases other acquired leases |
| `HotReloadClient(assetRuntime, sceneManager)` | Receives file events and coordinates asset, manifest, and scene reloads |
| `AssetLoaderRegistry` | Provides the loader selected by a descriptor's `loaderId` |

## Ownership

- The application owns the catalog, loader registry, and manager
- The manager owns loaded entries, handles, dependency leases, and reload state
- A successful `Acquire()` returns an `AssetLease`; releasing the lease drops one reference
- An `AssetScope` owns its acquired leases and releases each once when closed
- Callers borrow the asset and handle from a lease; access through a released lease throws

## Loading and dependency lifetime

| Member | Behaviour |
| --- | --- |
| `AssetManager(assetCatalog, loaderRegistry)` | Creates an empty manager for the supplied catalog and loader registry |
| `AssetLease.Asset` / `Handle` / `Release()` | Reads a leased asset or handle and releases one reference |
| `Acquire(assetId)` | Validates the dependency graph, loads the asset if needed, and resolves to a lease |
| `GetState(assetId)` | Returns `unloaded`, `loading`, `loaded`, `failed`, or `releasing` |
| `GetLoadedAssetIds()` | Returns IDs whose entries are currently loaded |
| `AssetHandle.Current` | Returns the current loaded object or throws while the handle is empty |
| `AssetHandle.Version` | Increments when an asset object is first installed and when a reload replaces it |

- Concurrent acquisitions share the load promise but receive separate leases
- The manager acquires declared dependencies before calling `loader.Load(descriptor, context)`
- `context.GetDependency(id)` returns only a declared dependency; other IDs throw
- Dependency cycles or unknown dependencies fail acquisition
- When the final lease is released, the loader's optional `Release(asset, descriptor)` runs, then dependency leases are released
- A failed load releases any dependencies acquired for that load; state becomes `failed`
- A later successful acquisition after a release loads a new entry; released assets report `unloaded`

## Asset scopes

| Member | Behaviour |
| --- | --- |
| `AssetScope(assetManager)` | Creates an open scope for the supplied manager |
| `AssetScope.Acquire(assetId)` | Acquires once per scope; repeated or concurrent requests for that ID share the same acquisition |
| `AssetScope.RetainOnly(assetIds)` | Waits for pending acquisitions and releases leases outside the retained ID set |
| `Get(assetId)` / `GetRequired(assetId)` | Returns an acquired asset or throws if it is missing for `GetRequired()` |
| `GetHandle(assetId)` / `GetHandleRequired(assetId)` | Returns an acquired handle or throws if it is missing for `GetHandleRequired()` |
| `ReleaseAll()` | Closes the scope, waits for pending acquisitions, releases all leases, and aggregates release failures |

- A scope cannot acquire or look up assets after release begins
- `RetainOnly()` waits for pending acquisitions before it releases leases; a later `Acquire()` remains retained until the next `RetainOnly()` call
- Repeated calls while release is in progress share the release promise; calls after disposal resolve immediately
- An acquisition that completes after scope closure releases its lease and rejects

## Reload transaction

| Member | Behaviour |
| --- | --- |
| `HotReloadClient.Connect()` | Opens the server event stream and returns `false` if it cannot connect |
| `HotReloadClient.CommitAtFrameBoundary()` | Commits ready replacements, returns whether a commit started, and is called before render preparation |
| `HotReloadClient.Dispose()` | Closes the stream and clears pending events |
| `StageReload(assetIds)` | Loads replacement objects for requested loaded assets and their loaded dependents without replacing active handles |
| `CommitStagedReload()` | Swaps ready replacements into handles and asynchronously releases prior objects and temporary leases |


1. `StageReload()` accepts one asset ID or an array; an empty array or a second active transaction throws
2. Every requested asset must already be loaded
3. The manager includes loaded assets that depend on the requested assets and orders replacements dependency-first
4. New replacements load while current handles still point to the old assets
5. On staging failure, the manager releases staged objects and keeps current handles unchanged
6. `CommitStagedReload()` returns `null` while staging or when no transaction exists
7. When ready, commit replaces each handle synchronously, clears the active transaction, then releases old objects and temporary leases asynchronously

- The stage result lists `requestedAssetIds` and `affectedAssetIds`
- The commit promise resolves with `assetIds`; cleanup failure rejects after replacements have already committed
- A new `Acquire()` waits for the active staging transaction to finish

## Browser hot reload

- `server.cjs` watches files under `assets/` recursively and sends debounced `asset-change` events over `/api/hot-reload`
- `HotReloadClient.Connect()` opens an `EventSource`; it returns `false` if unavailable or if connection construction fails
- Asset source changes stage loaded assets; the next frame-boundary callback commits ready replacements
- A change to the active scene URL reloads that scene through `SceneManager`
- A manifest change or full rescan creates a candidate catalog and manager, then reloads the active scene against them
- If a manifest reload cannot replace the active scene, the previous runtime remains selected
- The server does not watch `src/` or shader source files, so JavaScript and WGSL edits do not trigger this asset reload flow
- `Dispose()` closes the event source and clears pending events; a ready staged reload is committed during disposal

## Current scope

- Reload requires the requested asset and its affected loaded dependents to be loaded
- Reload is coordinated in the browser and assumes asset loaders can create replacement objects
- The manager does not reload JavaScript modules or WGSL source

## Source

- `src/core/assets/asset-manager.js`
- `src/core/assets/asset-lease.js`
- `src/core/assets/asset-dependency-resolver.js`
- `src/core/assets/asset-handle.js`
- `src/core/assets/asset-scope.js`
- `src/core/hot-reload-client.js`
- `src/core/assets/asset-catalog.js`
- `src/core/assets/asset-loader-registry.js`
- `server.cjs`
