# Entity Manager

## Purpose

`EntityManager` stores entity IDs, names, and components grouped by runtime component class. It provides queries and structural changes, but it does not define component behavior; systems do that. See [Scene Management](SCENE_MANAGEMENT_README.md) for scene ownership and deferred updates.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `EntityManager` | Creates and destroys entities, accesses components and names, runs `Query()`, and registers and dispatches removal handlers |
| `ComponentStorage` | Stores components in packed arrays and exposes `Size`, `Add()`, `Get()`, `Has()`, `Remove()`, and `EntityIds()` |
| `CommandBuffer` | Queues `AddComponent()`, `RemoveComponent()`, and `DestroyEntity()` commands, checks pending destruction, flushes, and disposes |
| `CreateEntityId()` / `IsEntityId()` | Creates and validates lowercase UUID entity IDs |

## Ownership

- A `Scene` owns its `EntityManager` and supplies a guard for structural changes
- The manager owns its entity set, name map, component stores, and pending removal records
- A component instance is stored by reference; the manager does not clone it
- Removal handlers run only when `DispatchComponentRemovals()` is called

## Entity and component API

| Member | Behaviour |
| --- | --- |
| `EntityManager(beforeStructuralChange)` | Creates an empty manager and accepts an optional structural-change guard |
| `StructuralRevision` | Returns the revision for entity or component membership changes |
| `EntityNameRevision` | Returns the revision for entity name changes |
| `CreateEntity(entityId, name)` | Creates a unique lowercase UUID and a trimmed non-empty name; the ID and name have defaults |
| `DestroyEntity(entityId)` | Removes one entity and its components; it throws if the ID is unknown or a query is active |
| `DestroyAllEntities()` | Destroys every entity, subject to the scene's structural-change guard |
| `GetEntityIds()` | Returns a new array of current IDs |
| `GetEntityName(entityId)` / `SetEntityName(entityId, name)` | Reads or replaces a validated entity name |
| `AddComponent(entityId, componentType, component)` | Stores an instance of the given class; duplicate membership throws |
| `GetComponent(entityId, componentType)` | Returns the stored component or `undefined` |
| `HasComponent(entityId, componentType)` | Returns whether the entity has that component type |
| `RemoveComponent(entityId, componentType)` | Removes a component and returns `true`, or returns `false` if it was absent |
| `GetComponentEntries(entityId)` | Returns the entity's component classes and instances |
| `Query(...componentTypes)` | Yields entities that have every requested component type |

- Entity IDs must be lowercase UUID strings
- Names must be non-empty strings; the manager trims them before storing
- `EntityNameRevision` increments only when `SetEntityName()` changes the trimmed name; assigning the same trimmed name does not increment it
- Entity and component membership changes affect `StructuralRevision`, not `EntityNameRevision`
- Component types must be classes, and component values must be instances of that class
- Unknown entity IDs throw `RangeError`; invalid types or values throw `TypeError`

## Queries and membership changes

- `Query(...componentTypes)` yields IDs that have every requested component
- A query requires at least one component class
- If any component type has no storage, the query yields no IDs
- The manager iterates the smallest component store, then checks the other stores
- Add, remove, or destroy operations are blocked while a query iterator is active
- Storage uses packed arrays; removing an item moves the last entry into its place, so iteration order is not stable

## Removal notifications

| Member | Behaviour |
| --- | --- |
| `RegisterComponentRemovalHandler(componentType, handler)` | Registers a handler and returns a function that unregisters it |
| `DispatchComponentRemovals()` | Calls registered handlers for queued removals and throws one `AggregateError` after all handlers run if any fail |

- Component removals caused by `RemoveComponent()` or entity destruction are queued only when that type has at least one handler
- A handler receives `{ entityId, componentType, component }`
- `EntityManager` does not dispatch notifications automatically

## Command buffer

| Member | Behaviour |
| --- | --- |
| `CommandBuffer()` | Creates an empty command queue |
| `AddComponent(entityId, componentType, component)` / `RemoveComponent(entityId, componentType)` | Queues a component membership change |
| `DestroyEntity(entityId)` | Queues destruction and returns `false` if that entity is already queued |
| `IsEntityPendingDestroy(entityId)` | Checks whether destruction is queued |
| `Flush(entityManager)` | Applies queued commands in order, attempts every command, then throws an `AggregateError` if any failed |
| `Dispose()` | Clears queued commands and prevents further use |

- Add and remove commands are rejected after the entity is queued for destruction
- A failed command does not stop later queued commands from running
- `Scene.FixedUpdate()` flushes the buffer after systems and parent changes

## Component storage API

| Member | Behaviour |
| --- | --- |
| `ComponentStorage.Size` | Returns the number of stored components |
| `Add(entityId, component)` / `Get(entityId)` / `Has(entityId)` / `Remove(entityId)` | Adds, reads, checks, or removes one entity's component |
| `EntityIds()` | Iterates the IDs in the packed store's current order |

## Current scope

- The manager is single-threaded and stores JavaScript object components
- It does not provide entity generations, archetypes, or stable query order
- Runtime parent changes must use `Scene.SetParent()`

## Source

- `src/core/ecs/entity-id.js`
- `src/core/ecs/entity-manager.js`
- `src/core/ecs/component-storage.js`
- `src/core/ecs/command-buffer.js`
- `src/core/scene/scene.js`
