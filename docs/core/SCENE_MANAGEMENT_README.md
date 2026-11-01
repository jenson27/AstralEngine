# Scene Management

## Purpose

`SceneManager` loads and switches the active `Scene`. A scene owns its entities, systems, and lifecycle; `SceneLoader` builds scenes from scene documents, and `SystemScheduler` runs registered systems. These parts do not implement game-specific system behavior or serialize component data. See [Entity Manager](ENTITY_MANAGER_README.md) and [Serialization](../serialization/SERIALIZATION_README.md) for related ECS and document details.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `SceneManager.constructor()` | Validates and stores the scene loader and load-options factory. |
| `SceneManager.ActiveScene` | Returns the active scene or `null`. |
| `SceneManager.LoadScene()` | Loads a scene, activates it, and disposes the previous scene. |
| `SceneManager.FixedUpdate()` / `PrepareRender()` | Forwards frame callbacks to the active scene. |
| `SceneManager.Dispose()` | Clears and disposes the active scene. |
| `Scene.constructor()` | Creates an uninitialized scene with its ECS and system scheduler. |
| `Scene.Name` / `EntityManager` / `CommandBuffer` / `ActiveCameraEntityId` | Exposes the scene name, ECS services, and active camera ID. |
| `Scene.AddSystem()` | Registers a system before scene initialization. |
| `Scene.SetActiveCameraEntity()` | Selects an entity that has `Camera` and `Transform`. |
| `Scene.Initialize()` | Initializes registered systems and activates the scene. |
| `Scene.FixedUpdate()` / `PrepareRender()` | Runs the matching system phase and scene update work. |
| `Scene.Dispose()` | Clears scene entities and shuts down initialized systems. |
| `SystemPhase` | Defines the `FixedUpdate` and `PrepareRender` phases. |
| `SystemScheduler.constructor()` | Creates an empty system list for each phase. |
| `SystemScheduler.AddSystem()` | Validates and registers a system for a phase. |
| `SystemScheduler.GetSystems()` | Returns the unique registered systems. |
| `SystemScheduler.Run()` | Calls systems in registration order for one phase. |
| `SceneLoader.constructor()` | Validates and stores the component registry and fetch function. |
| `SceneLoader.Load()` | Fetches, parses, validates, and builds a scene from a URL. |
| `SceneLoader.LoadData()` | Builds a scene from data and optional systems and services. |

## Ownership

- `SceneManager` stores the scene loader and load-options factory supplied by its caller.
- Once activated, the `SceneManager` owns the active scene's lifecycle. It disposes the old scene after a successful replacement and disposes the active scene when the manager is disposed.
- `Scene` owns its `EntityManager`, `CommandBuffer`, `SystemScheduler`, and list of initialized systems.
- Systems and services are stored as references. The scene does not clone them.
- `SceneLoader` stores references to the component registry and fetch function. It does not own loaded assets or external services.

## Scene loading and replacement

- `LoadScene(url)` throws if the manager is disposed or another load is in progress.
- The manager calls its load-options factory with the URL, then calls `SceneLoader.Load(url, options)`.
- A loaded scene must be an object with a non-empty string `Name` and `FixedUpdate()`, `PrepareRender()`, and `Dispose()` functions.
- If loading fails or returns an invalid scene, the current active scene remains active.
- If a returned candidate is rejected, the manager attempts to call its `Dispose()` method during cleanup when that method exists. The current active scene is retained when the loader returns that same object.
- The manager assigns the new scene as active before disposing the previous scene.
- If disposing the previous scene throws, the manager logs the error and still returns the new active scene.
- If the loader returns the same object as the current scene, the manager keeps it and does not dispose it.
- If the manager is disposed while a load is pending, the loaded scene is rejected and disposed when the load completes.
- `ActiveScene` is `null` before the first successful load and after manager disposal.
- `FixedUpdate()` and `PrepareRender()` throw if the manager is disposed or has no active scene.
- Repeated calls to `SceneManager.Dispose()` do nothing. The manager clears `ActiveScene` before disposing the scene, so it stays disposed if scene cleanup throws.

## Scene document loading

- `SceneLoader.Load()` fetches the URL, rejects non-success HTTP responses, parses the response as JSON, and passes the data to `LoadData()`.
- Load errors are wrapped with the failing stage and URL. Invalid JSON is reported as a scene-response parse error with the parse error as its cause.
- `LoadData()` accepts only `astral-scene` document version 1. Entity IDs and the active camera ID must be lowercase UUID strings.
- Scene version 1 requires a list of component records with unique non-empty type IDs, positive component versions, and a `data` field.
- Legacy scene layouts that used numeric entity IDs or component maps are not supported.
- The loader registers supplied systems, creates entities and components, sets the active camera, and initializes the scene.
- If building or initializing the scene fails, the loader disposes the partial scene. If cleanup also fails, it throws an `AggregateError` containing both errors.
- See [Serialization](../serialization/SERIALIZATION_README.md) for the scene document shape and component record details.

## Scene initialization and systems

- A scene starts in the `created` state. `AddSystem()` only works in this state.
- `SystemPhase.FixedUpdate` systems must provide `FixedUpdate()`. `SystemPhase.PrepareRender` systems must provide `PrepareRender()`.
- The scheduler rejects an unknown phase, a system missing its phase method, a duplicate system in the same phase, or a registration while systems are running.
- The scheduler rejects a recursive `Run()` call.
- `Initialize(services)` can run only once. It calls each unique registered system's optional `Initialize(scene, services)` method in registration order.
- If initialization fails, the scene enters the `failed` state. Systems already reached during initialization are retained for shutdown.
- `FixedUpdate(deltaTime, elapsedTime)` runs the fixed-update phase with those values in a context object.
- After the fixed-update phase, the scene flushes the command buffer and dispatches component-removal notifications, even if the phase throws.
- Errors from the fixed-update phase, command flush, and removal dispatch are combined into an `AggregateError`.
- `PrepareRender(interpolationAlpha, aspectRatio)` runs the render-preparation phase with those values in a context object. A system error propagates and stops the remaining systems in that phase.
- Updates and render preparation throw if the scene is not active.

## Active camera

- `SetActiveCameraEntity(entityId)` requires a lowercase UUID for an existing entity with both `Camera` and `Transform`.
- The entity manager's structural-change guard prevents destroying the active camera or removing either required component before another camera is selected.
- During scene disposal, the scene clears entities and the active camera through its disposal path.

## Disposal

- `Dispose()` throws if called during system initialization.
- Repeated calls while disposing or after disposal do nothing.
- Disposal marks the scene as disposing, disposes the command buffer, destroys all entities, and dispatches component-removal notifications.
- It then calls optional `Shutdown(scene)` methods in reverse initialization order.
- The scene becomes disposed even if cleanup steps fail. It throws an `AggregateError` after attempting all cleanup steps.

## Design choices and tradeoffs

- **Replace only after loading succeeds.** A failed load keeps the current scene available, but the caller must handle the load error.
- **Run fixed-update cleanup after system errors.** Queued entity changes and removal notifications still run, but the scene reports the errors after those steps.
- **Keep phase order explicit.** Systems run in their registration order, so callers control system order by registration.

## Current scope

- Scene documents are fetched through the supplied fetch function. Their format is described in [Serialization](../serialization/SERIALIZATION_README.md).
- Scenes do not automatically choose a camera; callers set the active camera.
- Systems must be supplied by the caller. The scene does not discover or construct systems by name.

## Source

- `src/core/scene-manager.js`
- `src/core/scene.js`
- `src/core/scene-loader.js`
- `src/core/system-scheduler.js`
