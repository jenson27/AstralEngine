# Graphics

## Purpose

The graphics system turns mesh and material data into WebGPU draw calls. `RenderSystem` gathers entity data, and `WebGPURenderer` owns GPU resources and submits each frame. It currently supports textured meshes with UV coordinates; it does not implement lighting or a general-purpose material model. See [Mesh Renderer](../components/graphics/MESH_RENDERER_README.md), [Asset Registry](../core/ASSET_REGISTRY_README.md), and [Asset Manager](../core/ASSET_MANAGER_README.md).

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `Mesh.constructor()` | Validates and copies vertex positions, UVs, and submesh ranges. |
| `Mesh.VertexCount` / `Submeshes` | Exposes the vertex count and frozen material-slot ranges. |
| `Mesh.GetPositions()` / `GetUVs()` | Returns copies of the vertex position and UV arrays. |
| `Material.constructor()` | Stores a decoded base-color image asset. |
| `Material.BaseColorTexture` | Returns the material's image asset. |
| `CreateCubeMesh()` / `CreateTriangleMesh()` | Creates built-in mesh data. |
| `BuiltinMeshLoader.Load()` | Loads the supported built-in cube or triangle mesh. |
| `ImageTextureLoader.constructor()` | Stores fetch and bitmap-decoding functions. |
| `ImageTextureLoader.Load()` / `Release()` | Fetches, decodes, and closes image bitmaps. |
| `MaterialLoader.Load()` | Creates a material from a declared texture dependency. |
| `MeshRenderer.constructor()` | Checks a mesh and its material for each material slot. |
| `MeshRenderer.MaterialsBySlot` / `GetMaterialForSlot()` | Exposes the frozen material-slot map or one material. |
| `RenderSystem.constructor()` | Stores a renderer that accepts render items. |
| `RenderSystem.PrepareRender()` | Builds render items from the active camera and scene entities. |
| `WebGPURenderer.Initialize()` | Creates the WebGPU device, canvas configuration, pipeline, sampler, and transform resources. |
| `WebGPURenderer.SetRenderItems()` | Validates render items and prepares GPU resources and draw data. |
| `WebGPURenderer.EnsureDepthTexture()` | Creates or resizes the depth texture for the canvas. |
| `WebGPURenderer.Render()` | Records and submits the render pass. |
| `WebGPURenderer.Shutdown()` | Releases renderer-owned GPU resources and device state. |
| `triangle.wgsl` | Defines the vertex and fragment shader entry points. |

## Mesh and material data

- `Mesh` receives `Float32Array` positions and UVs.
- Positions contain complete XYZ triangles.
- Each vertex must have one UV pair.
- If no submeshes are supplied, the mesh gets one `default` material slot for all vertices.
- A submesh contains:
  - `materialSlot` - Non-empty and unique slot name
  - `firstVertex` - First vertex in the range
  - `vertexCount` - Positive triangle-aligned count
- Submesh ranges must cover every vertex with no gaps or overlap.
- `Mesh` copies the input arrays. `GetPositions()` and `GetUVs()` return further copies.
- `Material` requires a base-color texture with a decoded `bitmap`.
- `MeshRenderer` requires a `Material` for every mesh slot and rejects unknown slots.
- Passing one `Material` to `MeshRenderer` assigns it to every slot.

## Asset loaders

- `BuiltinMeshLoader.Load()` accepts primitive sources named `cube` or `triangle`.
- `ImageTextureLoader.Load()` accepts an image source with a non-empty URL.
- The image loader checks the HTTP response, reads its blob, and decodes it with `createImageBitmap()`.
- The returned image asset contains `bitmap`, `width`, and `height`.
- Invalid decoded dimensions close the bitmap before reporting an error.
- `ImageTextureLoader.Release()` closes the bitmap.
- `MaterialLoader.Load()` accepts a material source with a base-color texture asset ID.
- It gets that texture through the asset manager's declared-dependency context.
- Asset dependencies keep the texture alive while the material is leased. See [Asset Manager](../core/ASSET_MANAGER_README.md).

## Render preparation

1. `RenderSystem.PrepareRender()` gets the active camera and its `Transform`.
2. It asks the camera to update its view and projection matrices using the canvas aspect ratio.
3. It queries entities with both `Transform` and `MeshRenderer`.
4. It creates one render item per matching entity with its mesh, materials, and model matrix.
5. It passes the render items and camera matrices to `WebGPURenderer.SetRenderItems()`.

- Rendering fails if the active camera or its transform is missing.
- Mesh and material asset IDs are resolved while the scene loads. The render system uses the resulting runtime objects.

## WebGPU setup and frame rendering

- `Initialize()` requires browser WebGPU support, an available adapter, a device, and a `webgpu` canvas context.
- The renderer loads `triangle.wgsl` and creates the render pipeline.
- The vertex format is three position floats and two UV floats.
- Each render item must contain a `Mesh`, a 16-value model matrix, and a `Material` for every submesh slot.
- `SetRenderItems()` uploads model, view, and projection matrices to a dynamic uniform buffer.
- Mesh buffers, image textures, and material bind groups are cached by their runtime object.
- The renderer creates one draw item for each mesh submesh.
- `Render()` clears the color and depth attachments, issues each draw, and submits the command buffer.
- A lost WebGPU device is logged. A later `Render()` call throws with the loss information.

## GPU resource lifetime

- The renderer destroys mesh buffers that are absent from the latest render-item list.
- It removes material bind groups and textures that are absent from the latest active materials.
- These resources are pruned when `SetRenderItems()` runs.
- `Shutdown()` unconfigures the canvas context, destroys cached buffers and textures, clears renderer state, and destroys the device.
- The renderer does not own the CPU-side mesh, material, or image asset objects.

## Design choices and tradeoffs

- **Use WebGPU directly.** This keeps the graphics API visible for learning, but the browser must support WebGPU.
- **Keep GPU caches in the renderer.** Asset loaders create CPU-side objects; the renderer creates GPU resources when those objects are used.
- **Use submeshes for material slots.** One mesh can use several materials, but each slot creates a separate draw item.

## Current scope

- Materials contain one base-color texture and use the renderer's shared repeating linear sampler.
- The shader does not use lighting, normals, or shadows.
- The renderer does not load model files. It currently uses built-in primitives.
- The renderer does not recover a lost WebGPU device.

## Source

- `src/graphics/webgpu-renderer.js`
- `src/graphics/mesh.js`
- `src/graphics/material.js`
- `src/graphics/shaders/triangle.wgsl`
- `src/graphics/primitives/cube.js`
- `src/graphics/primitives/triangle.js`
- `src/graphics/assets/builtin-mesh-loader.js`
- `src/graphics/assets/image-texture-loader.js`
- `src/graphics/assets/material-loader.js`
- `src/components/graphics/mesh-renderer.js`
- `src/systems/render-system.js`
