# Model Renderer

## Purpose

`ModelRenderer` associates a model asset handle with an entity so `RenderSystem` can submit the model's static primitives to `WebGPURenderer`. It does not own the loaded model; the scene asset scope keeps the handle loaded. See [Asset Manager](../../core/ASSET_MANAGER_README.md), [Graphics](../../graphics/GRAPHICS_README.md), and [GLB Assets](../../graphics/GLB_ASSETS_README.md) for context.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `ModelRenderer(modelHandle)` | Validates and stores a handle containing a `ModelAsset` |
| `SetModelHandle(modelHandle)` | Replaces the stored handle after validating its current value |
| `ModelHandle` | Returns the stable handle used for serialization and rendering |
| `Model` | Returns the current `ModelAsset` from the handle |
| `modelRenderer` scene codec | Stores and resolves the model asset ID using component version `1` |
| `RenderSystem` | Composes the entity world matrix with each primitive transform and creates render items |
| Profiler scope | Measures CPU render-item preparation for this model asset when capture is active |

## Ownership and replacement

- `ModelRenderer` stores a reference to an `AssetHandle`; it does not acquire or release leases
- The scene `AssetScope` owns the lease for the model ID
- Hot reload can replace the handle's current model without replacing the component
- `SetModelHandle()` rejects values that are not `AssetHandle` instances or do not currently contain a `ModelAsset`

## Scene data

- The serialized component type ID is `modelRenderer`
- `data.modelAssetId` identifies the model descriptor in the asset manifest
- The scene `assets` array must include that model asset ID
- The entity must also have a `Transform` for `RenderSystem` to prepare the model
- Component version remains `1`

## Current scope

- The component renders the static mesh and material primitives provided by `ModelAsset`
- It does not define per-instance materials, animation state, or visibility settings
- See [GLB Assets](../../graphics/GLB_ASSETS_README.md) for the supported source content

## Source

- `src/components/graphics/model-renderer.js`
- `src/components/register-scene-components.js`
- `src/systems/render-system.js`
- `src/graphics/model-asset.js`
