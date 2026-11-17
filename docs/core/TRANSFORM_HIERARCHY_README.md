# Transform Hierarchy

## Purpose

`Parent` links one entity to another, and `TransformHierarchySystem` computes world matrices from local transforms. `Scene` validates runtime reparenting and destroys subtrees in child-first order. The hierarchy does not change local transforms to preserve the old world position during reparenting. See [Transform](../components/TRANSFORM_README.md) for local transform and interpolation behavior.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `Parent(parentEntityId)` / `Parent.ParentEntityId` | Stores and exposes a parent's entity ID |
| `Scene.SetParent(childEntityId, parentEntityId)` | Queues a parent change or detaches the child when the parent is `null` |
| `Scene.DestroyEntity(entityId)` | Queues destruction of an entity and all descendants |
| `TransformSnapshotSystem.FixedUpdate(scene)` | Captures transform state at fixed-update boundaries |
| `TransformHierarchySystem.PrepareRender(scene, context)` | Computes interpolated world matrices from roots to children |
| `SceneLoader` | Validates serialized parent links before building the scene |

## Parent data

- `Parent(parentEntityId)` requires a lowercase UUID
- `Parent.ParentEntityId` returns the stored ID
- Scene JSON stores the link as a `parent` component with `data.parentEntityId`
- Both child and parent must have `Transform`
- An entity can have at most one parent because it stores one `Parent` component

## World matrices

- Local matrices come from `Transform.GetInterpolatedModelMatrix(alpha)`
- The hierarchy system calculates `parentWorldMatrix × localMatrix`
- Root transforms copy their local matrix to `WorldMatrix`
- `TransformSnapshotSystem.FixedUpdate()` captures the previous state before the other fixed-update systems in the current application setup
- `TransformHierarchySystem.PrepareRender()` runs before `RenderSystem` so rendering reads updated world matrices
- A missing transform on either end of a parent link or a cycle causes an error

## Reparenting

| Member | Behaviour |
| --- | --- |
| `Scene.SetParent(childEntityId, parentEntityId = null)` | Requires an active scene and transforms on both entities, validates the pending graph, then queues the change |

- The method returns `false` when the requested relationship is already current and `true` when it queues a change
- `null` removes the parent link
- The child's local position, rotation, and scale stay unchanged; its world matrix changes with the new parent
- Changes are applied after fixed-update systems and before command-buffer flush
- Runtime code must use `Scene.SetParent()`; direct add/remove of `Parent` on an active scene throws
- A cycle or an entity queued for destruction causes the request to throw

## Cascade deletion

- `Scene.DestroyEntity(rootId)` finds descendants and queues them child-first
- The call returns `false` if the root was already queued, otherwise `true`
- The active camera cannot be inside the subtree; switch cameras first
- Directly destroying an entity with children through `EntityManager` is blocked by the scene guard
- Removing `Transform` from an entity with a parent or children is blocked until the relationship is detached

## Scene loading

- The loader requires every parent ID to identify an entity in the same scene
- Both the child and parent need a serialized `transform` component
- Parent cycles are rejected before the scene is constructed
- Component records are not required to list parents before children

## Current scope

- Reparenting preserves local transforms, not world transforms
- There is no public child list or hierarchy editor API
- The system rebuilds its hierarchy cache after ECS structural changes and recomputes world matrices during each render preparation

## Source

- `src/components/parent.js`
- `src/components/transform.js`
- `src/core/scene.js`
- `src/core/scene-loader.js`
- `src/systems/transform-snapshot-system.js`
- `src/systems/transform-hierarchy-system.js`
