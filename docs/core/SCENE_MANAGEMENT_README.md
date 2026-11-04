# Scene Management

## Purpose

`SceneLoader` builds a scene from a versioned JSON document, and `SceneManager` owns the active scene and its asset scope. A `Scene` runs systems and coordinates deferred structural changes. These classes do not implement rendering or component-specific behavior; systems and the renderer do that. See [Entity Manager](ENTITY_MANAGER_README.md) and [Serialization](../serialization/SERIALIZATION_README.md) for related data handling.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `Scene` | Owns scene state and exposes system, camera, hierarchy, update, and disposal methods |
| `SceneLoader` | Fetches, validates, and builds scenes with `Load()`, `LoadData()`, and `LoadDataAsync()` |
| `SceneManager` | Switches and updates the active scene with `LoadScene()`, `FixedUpdate()`, `PrepareRender()`, and `Dispose()` |
| `SystemPhase` / `SystemScheduler` | Name and execute the fixed-update and render-preparation phases |
| `Scene.Name`, `EntityManager`, `CommandBuffer`, and `ActiveCameraEntityId` | Expose the scene's name and runtime services |
| `SceneManager.ActiveScene` / `ActiveSceneUrl` | Expose the active scene and its source URL |

## Ownership

- A `SceneManager` owns its active scene and optional `AssetScope`
- A `Scene` owns its `EntityManager`, `CommandBuffer`, scheduler, and initialized systems
- Scene data and load services are supplied by the caller; component constructors may retain service-backed asset handles
- A failed candidate load is disposed and its asset scope is released; the active scene remains in place

## Scene document requirements

- `format` must be `astral-scene` and `version` must be `1`
- `name` must be a non-empty string and `entities` must be an array
- Each entity has a lowercase UUID `id`, optional non-empty `name`, and a `components` array
- Each component record has a unique `typeId`, positive integer `version`, and `data`
- `activeCameraEntityId` must refer to an entity with `camera` and `transform` components
- Optional `assets` must contain unique, non-empty asset IDs
- Parent links must refer to existing transform entities and must not form a cycle
- Mesh renderer asset references must be declared by the scene's `assets` list

## Loading and switching

| Member | Behaviour |
| --- | --- |
| `Scene(name)` | Creates a scene in the `created` state |
| `SceneLoader(componentRegistry, fetcher)` | Creates a loader with a component registry and fetch function |
| `SceneManager(sceneLoader, createLoadOptions, createAssetScope)` | Creates a manager with load-option and optional asset-scope factories |
| `SceneLoader.Load(url, options)` | Fetches the document, parses JSON, validates it, loads assets, and builds the scene |
| `SceneLoader.LoadData(data, options)` | Builds from an object synchronously; when scene assets are listed, `options.assetScope` must provide them |
| `SceneLoader.LoadDataAsync(data, options)` | Validates scene structure and the active camera before acquiring declared assets and building |
| `SceneManager.LoadScene(url)` | Loads one candidate at a time and activates it only after the loader returns a valid scene |
| `SceneManager.ActiveScene` / `ActiveSceneUrl` | Return the active scene and its URL, or `null` before a scene is active |

- A concurrent `LoadScene()` call throws
- The previous scene remains active while a candidate is loading
- After activation, the manager disposes the previous scene and releases its asset scope
- If loading or validation fails before activation, the candidate is cleaned up and the previous active scene remains
- The manager forwards `FixedUpdate(deltaTime, elapsedTime)` and `PrepareRender(interpolationAlpha, aspectRatio)` to the active scene; either call throws when no scene is active

## System and scene lifecycle

1. `SceneLoader` registers supplied systems before initialization
2. It creates entities and deserializes their component records
3. It validates and sets the active camera, then calls `Scene.Initialize(services)`
4. `Initialize()` calls each unique system's optional `Initialize(scene, services)` in scheduler order
5. Each fixed update runs fixed systems, applies queued parent changes, flushes ECS commands, and dispatches component removals
6. Render preparation runs the `PrepareRender` systems with interpolation alpha and aspect ratio
7. `Dispose()` destroys entities, dispatches removal notifications, then calls system `Shutdown(scene)` in reverse initialization order

- Fixed-update failures are collected across the update phases and returned as an `AggregateError`
- A scene can be initialized only once; systems must be added before initialization
- Disposal is idempotent, but disposal during initialization throws

## Scene manager disposal

- `SceneManager.Dispose()` clears its active references, disposes the active scene, releases its scope, and waits for an in-progress load to finish
- Repeated calls return the same disposal promise
- Cleanup errors are aggregated after cleanup attempts

## Current scope

- Scene documents use version `1`; no scene-format migration layer exists
- The active camera is required
- Switching scenes replaces the current scene; there is no additive scene stack

## Source

- `src/core/scene.js`
- `src/core/scene-loader.js`
- `src/core/scene-manager.js`
- `src/core/system-scheduler.js`
