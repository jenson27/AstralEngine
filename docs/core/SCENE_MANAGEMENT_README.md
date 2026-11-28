# Scene Management

## Purpose

`SceneLoader` fetches and parses a versioned JSON document. `SceneDocumentValidator` checks the document, and `SceneBuilder` creates and initializes the scene. `SceneManager` owns the active scene and its asset scope. A `Scene` runs systems and coordinates deferred structural changes through `SceneHierarchy`. These classes do not implement rendering or component-specific behavior; systems and the renderer do that. See [Entity Manager](ENTITY_MANAGER_README.md) and [Serialization](../serialization/SERIALIZATION_README.md) for related data handling.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `Scene` | Owns scene state, system scheduling, camera policy, updates, and disposal |
| `SceneHierarchy` | Owns parent links, hierarchy checks, deferred changes, and subtree traversal |
| `SceneLoader` | Fetches and parses scene data, then coordinates validation, asset loading, and scene building |
| `SceneDocumentValidator` | Validates scene format, entities, components, hierarchy, camera, and asset references |
| `SceneBuilder` | Creates entities and components, sets the active camera, and initializes the scene |
| `SceneManager` | Switches and updates the active scene with `LoadScene()`, `FixedUpdate()`, `PrepareRender()`, and `Dispose()` |
| `SystemPhase` / `SystemScheduler` | Name and execute the fixed-update and render-preparation phases |
| `Scene.Name`, `EntityManager`, `CommandBuffer`, and `ActiveCameraEntityId` | Expose the scene's name and runtime services |
| `SceneManager.ActiveScene` / `ActiveSceneUrl` | Expose the active scene and its source URL |

## Ownership

- A `SceneManager` owns its active scene and optional `AssetScope`
- A `Scene` owns its `EntityManager`, `CommandBuffer`, scheduler, `SceneHierarchy`, and initialized systems
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
- `meshRenderer` asset references are checked against the scene's `assets` list during document validation
- `modelRenderer.data.modelAssetId` must also be in `assets`; the built-in codec resolves it through `ResolveModelHandle` from the scene asset scope during scene building
- `spriteAnimator.data.animationAssetId` must be in `assets`; scene asset reference collection and validation handle this reference

## Loading and switching

| Member | Behaviour |
| --- | --- |
| `Scene(name)` | Creates a scene in the `created` state |
| `SceneLoader(componentRegistry, fetcher)` | Creates a loader with a component registry and fetch function |
| `SceneManager(sceneLoader, createLoadOptions, createAssetScope)` | Creates a manager with load-option and optional asset-scope factories |
| `SceneLoader.Load(url, options)` | Fetches and parses the document, validates it through `SceneDocumentValidator`, loads assets, then builds through `SceneBuilder` |
| `SceneLoader.LoadData(data, options)` | Validates and builds from an object synchronously; when scene assets are listed, `options.assetScope` must provide them |
| `SceneLoader.LoadDataAsync(data, options)` | Validates scene structure and the active camera before acquiring declared assets, then builds the scene |
| `SceneManager.LoadScene(url)` | Loads one candidate at a time and activates it only after the loader returns a valid scene |
| `SceneManager.ActiveScene` / `ActiveSceneUrl` | Return the active scene and its URL, or `null` before a scene is active |

- A concurrent `LoadScene()` call throws
- The previous scene remains active while a candidate is loading
- After activation, the manager disposes the previous scene and releases its asset scope
- If loading or validation fails before activation, the candidate is cleaned up and the previous active scene remains
- The manager forwards `FixedUpdate(deltaTime, elapsedTime)` and `PrepareRender(interpolationAlpha, aspectRatio)` to the active scene; either call throws when no scene is active

## System and scene lifecycle

1. `SceneLoader` coordinates document validation, asset loading, and scene building
2. `SceneDocumentValidator` validates the document; `SceneBuilder` registers supplied systems, creates entities, and deserializes their component records
3. `SceneBuilder` sets the active camera and calls `Scene.Initialize(services)`
4. `Initialize()` calls each unique system's optional `Initialize(scene, services)` in scheduler order
5. Each fixed update runs fixed systems, applies queued parent changes through `SceneHierarchy`, flushes ECS commands, and dispatches component removals
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

- `src/core/scene/scene.js`
- `src/core/scene/scene-hierarchy.js`
- `src/core/scene/scene-loader.js`
- `src/core/scene/scene-document-validator.js`
- `src/core/scene/scene-document-asset-validator.js`
- `src/core/scene/scene-builder.js`
- `src/core/scene/scene-manager.js`
- `src/core/scene/system-scheduler.js`
