# Mesh Renderer

## Purpose

`MeshRenderer` stores a reference to a `Mesh` for an entity. It does not create GPU resources or draw the mesh; `RenderSystem.Prepare()` reads it when building render items. See [Transform](../TRANSFORM_README.md) for the model transform used with the mesh.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `MeshRenderer` | Stores a mesh reference for an entity. |
| `constructor()` | Checks that the supplied value is a `Mesh` and stores it. |
| `RenderSystem.Prepare()` | Reads `MeshRenderer` and `Transform` components to create render items. |

## Ownership

- `MeshRenderer` stores the supplied `Mesh` by reference.
- It does not copy or release the mesh.

## Mesh data

- `mesh` - The `Mesh` used by the render system. The constructor requires an instance of `Mesh`.

## Behaviour

- The constructor throws a `TypeError` if the supplied value is not a `Mesh`.
- `RenderSystem.Prepare()` includes an entity only when it has both `Transform` and `MeshRenderer`.
- The renderer receives the mesh reference and the transform's model matrix.

## Current scope

- The component does not upload mesh data to the GPU.
- The component does not control material, visibility, or render order.

## Source

- `src/components/graphics/mesh-renderer.js`
- `src/systems/render-system.js`
- `src/graphics/mesh.js`
