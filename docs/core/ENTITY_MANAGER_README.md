# Entity Manager

## Purpose

`EntityManager` creates entity IDs and stores component objects by an explicitly supplied component type. `ComponentStorage` stores each component type, and `CommandBuffer` queues membership changes for later application. The entity manager does not run game logic; systems query it and update component data. See [Engine](ENGINE_README.md) for how the engine calls game updates.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `EntityManager` | Owns entity IDs, component stores, query state, and component-removal handlers. |
| `EntityManager.constructor()` | Initializes the entity ID counter and empty ECS stores. |
| `CreateEntity()` | Creates and returns a new entity ID. |
| `DestroyEntity()` | Removes an entity and all its components. |
| `AddComponent()` | Stores a component under the supplied component type. |
| `GetComponent()` / `HasComponent()` | Reads or checks a component for an entity. |
| `RemoveComponent()` | Removes a component and queues its removal notification when handlers exist. |
| `RegisterComponentRemovalHandler()` | Registers a handler for removal of one component type and returns an unregister function. |
| `DispatchComponentRemovals()` | Calls queued removal handlers and reports handler errors. |
| `Query()` | Yields entities that have every requested component type. |
| `ComponentStorage` | Stores entity IDs and component objects for one component type. |
| `ComponentStorage.constructor()` | Initializes the storage arrays and entity index. |
| `Size` / `EntityIds()` | Reports the number of stored components and yields their entity IDs. |
| `Add()` / `Get()` / `Has()` / `Remove()` | Adds, reads, checks, or removes a component in one storage. |
| `CommandBuffer` | Queues component additions, removals, and entity destruction. |
| `CommandBuffer.constructor()` | Initializes the command queue and pending-destruction set. |
| `AddComponent()` / `RemoveComponent()` / `DestroyEntity()` | Adds a structural change to the command queue. |
| `Flush()` | Applies queued commands in order and reports command errors. |

## Ownership

- `EntityManager` owns the entity `Set`, the component-store `Map`, and each `ComponentStorage`.
- Each `ComponentStorage` owns arrays of entity IDs and component references, plus an index `Map`.
- Component objects are stored by reference. The manager does not clone them.
- A `CommandBuffer` owns its queued commands and pending-destruction set. The caller creates it and passes it to `Flush()`.
- Queued component-removal records keep references to removed components until they are dispatched.

## Entity and component data

- Entity IDs start at `1` and increase. Destroyed IDs are not reused.
- Component stores are keyed by the component type supplied to `AddComponent()`.
- A component-removal record contains `entityId`, `componentType`, and `component`.
- Add-component commands contain an entity ID, a component type, and a component instance.

## Entity and component changes

- `CreateEntity()` adds a new ID to the entity set. It throws a `RangeError` when the next ID is not a safe integer.
- Operations that require an existing entity throw a `RangeError` for an unknown ID.
- `AddComponent()` requires a component type and an instance of that type. It throws if the instance does not match the type or the entity already has that component type.
- `GetComponent()` returns `undefined` when the entity has no component of that type.
- `HasComponent()` returns `false` when no store or component exists for that type.
- `RemoveComponent()` returns `false` when the component is absent. Otherwise, it removes the component and returns `true`.
- `DestroyEntity()` removes the entity and all its components. It does not return a value.
- Component type arguments must be class constructors. Invalid types cause a `TypeError`.
- `RegisterComponentRemovalHandler()` throws a `TypeError` if the handler is not a function.

## Queries and membership changes

- `Query()` requires at least one component type. An empty query throws a `TypeError`.
- A query with an unregistered component store yields no entities.
- A query yields entities that have all requested component types.
- `ComponentStorage.Add()` throws if the entity already has a component in that store. `Get()` returns `undefined` when the entity is absent, and `Remove()` returns `false` when there is no component to remove.
- `ComponentStorage.Remove()` moves the last stored entry into a removed entry's position. This keeps removal compact, but component iteration order can change.
- `AddComponent()`, `RemoveComponent()`, and `DestroyEntity()` throw if called while a query is being iterated.
- `CreateEntity()` is allowed during iteration, but the new entity cannot gain or lose component membership until the active query has ended.
- Use `CommandBuffer` to defer membership changes until after system queries finish.

## Removal notifications

- `RegisterComponentRemovalHandler()` stores handlers in a `Set`, so registering the same function twice does not add a duplicate.
- The returned function unregisters that handler.
- A removal is queued only if at least one handler for its type exists when the component is removed.
- At dispatch time, the manager calls the handlers then registered for that component type. If no handlers remain, it skips the queued record.
- `DispatchComponentRemovals()` clears the current queue before it calls handlers. Removals queued by handlers are left for the next dispatch.
- It calls all registered handlers even if some throw, then throws an `AggregateError` containing the handler errors.
- Removing an entity queues a removal record for each component type that has registered handlers.

## Command buffer

- `AddComponent()` queues the component type and instance. `AddComponent()` and `RemoveComponent()` do not validate the entity or component type until `Flush()`.
- `DestroyEntity()` returns `false` if that entity is already queued for destruction. Otherwise, it queues the destroy and returns `true`.
- After an entity is queued for destruction, the command buffer rejects further component additions or removals for that entity.
- `Flush()` clears the current queue before applying its commands. Commands added later remain queued for a later flush.
- `Flush()` applies commands in order and continues after a command fails.
- After all commands run, `Flush()` throws an `AggregateError` if any commands failed.
- Pending-destruction markers are cleared after the flush, including when commands fail.

## Current scope

- Entity and component data are not serialized to JSON.
- The entity manager does not provide parent-child hierarchies or automatic system updates.
- Component stores use arrays and swap removal; iteration order is not stable.

## Source

- `src/core/ecs/entity-manager.js`
- `src/core/ecs/component-storage.js`
- `src/core/ecs/command-buffer.js`
