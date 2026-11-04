# Mesh Renderer

## Purpose

`MeshRenderer` associates a mesh asset handle with material asset handles for each mesh material slot. `RenderSystem` reads this component and passes its handles and the entity world matrix to `WebGPURenderer`. It does not own the loaded assets; the scene's asset scope keeps them alive. See [Asset Manager](../../core/ASSET_MANAGER_README.md) and [Graphics](../../graphics/GRAPHICS_README.md).

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `MeshRenderer(meshHandle, materialHandlesBySlot)` | Validates a loaded mesh handle and one loaded material handle per mesh slot |
| `mesh` | Returns the current mesh from the mesh handle |
| `MeshHandle` / `MaterialHandlesBySlot` | Expose the stable handles used by rendering and serialization |
| `MaterialsBySlot` | Returns a frozen object of current material values keyed by slot |
| `GetMaterialForSlot(materialSlot)` | Returns the current material for a slot or `undefined` |
| `GetMaterialHandleForSlot(materialSlot)` | Returns the handle for a slot or `undefined` |

## Ownership

- `MeshRenderer` stores references to handles; it does not acquire or release asset leases
- A scene `AssetScope` owns the leases that keep these handles loaded
- Hot reload can replace the handle's current value without replacing the `MeshRenderer`
- `MaterialsBySlot` is a new snapshot object on each access; the handles remain stable

## Slot mapping

- The mesh handle must currently contain a `Mesh`
- Every submesh material slot must have a handle containing a `Material`
- A material mapping for a slot that the mesh does not define throws
- Missing or invalid material handles throw during construction
- If a mesh reload changes its slot names, the existing material mapping may no longer match the new mesh; rebuild the component or scene with matching slots

## Scene data

- Serialized component type ID is `meshRenderer`
- `meshAssetId` identifies the mesh asset
- `materialsBySlot` maps each mesh slot name to a material asset ID
- Deserialization resolves IDs to acquired handles through `ResolveMeshHandle` and `ResolveMaterialHandle` services
- The scene must list every referenced mesh and material ID in its `assets` array

## Current scope

- Each mesh slot has exactly one material handle
- Materials provide a base-color texture in the current renderer
- The component does not store per-instance shader parameters

## Source

- `src/components/graphics/mesh-renderer.js`
- `src/components/register-scene-components.js`
- `src/systems/render-system.js`
- `src/graphics/mesh.js`
- `src/graphics/material.js`
