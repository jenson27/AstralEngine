# Graphics

## Purpose

The graphics layer defines CPU-side meshes and materials, builds render items from scene components, and submits textured geometry through WebGPU. It does not load scene JSON or choose the active scene; the scene and asset systems provide those inputs. See [Mesh Renderer](../components/graphics/MESH_RENDERER_README.md) and [Asset Manager](../core/ASSET_MANAGER_README.md).

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `Mesh` | Stores triangle vertices, UV coordinates, and material-slot ranges |
| `Material` | Holds a decoded base-color image asset |
| `RenderSystem.PrepareRender()` | Builds camera matrices and render items from scene components |
| `WebGPURenderer` | Prepares draw data and submits render commands through WebGPU |
| `WebGpuResourceCache` | Creates, reuses, prunes, and releases GPU mesh and material resources |
| `GpuTimingTracker` | Owns timestamp queries, readback buffers, and GPU frame timing |
| `BuiltinMeshLoader` | Creates a built-in primitive from an asset descriptor |
| `ImageTextureLoader` | Fetches and decodes an image and closes its bitmap on release |
| `MaterialLoader` | Builds a material from its declared texture dependency |
| `CreateTriangleMesh()` / `CreateCubeMesh()` / `CreatePlaneMesh()` | Create basic primitive meshes |
| `CreateSphereMesh()` / `CreateCylinderMesh()` / `CreateConeMesh()` / `CreateCapsuleMesh()` | Create parameterized primitive meshes |
| `primitive-utils.js` | Validates primitive parameters and builds triangle, radial, and cap data |
| `triangle.wgsl` | Transforms vertices and samples a base-color texture |

## Mesh and material data

- `Mesh` takes `Float32Array` position data in XYZ triples and one UV pair per vertex
- Vertices are non-indexed triangle-list data; the position count must be non-empty and divisible by nine numbers
- The constructor copies positions and UVs; `GetPositions()` and `GetUVs()` return copies
- `Submeshes` is a frozen list of `{ materialSlot, firstVertex, vertexCount }` records
- Slot names must be unique and non-empty; submesh ranges must cover every vertex exactly once with no gaps or overlap
- If submeshes are omitted, the mesh has one `default` slot
- `Material` requires a base-color texture object with a decoded `bitmap`

## Built-in meshes

- The loader supports `triangle`, `cube`, `plane`, `sphere`, `cylinder`, `cone`, and `capsule` source names
- Size, radius, and height values must be positive where required
- Segment counts must be integers within the minimums enforced by `primitive-utils.js`
- The current asset manifest registers cube, plane, sphere, cylinder, cone, and capsule; triangle creation is available but not listed there
- Mesh creation returns CPU-side `Mesh` objects; GPU buffers are created on demand by the renderer

## Asset loaders

- `BuiltinMeshLoader.Load(descriptor)` requires `source.kind === "primitive"` and a supported primitive name
- `ImageTextureLoader.Load(descriptor)` requires an image URL, fetches it, decodes a bitmap, and returns `{ bitmap, width, height }`
- Image fetch errors, invalid responses, or invalid decoded dimensions reject the load; invalid bitmaps are closed
- `ImageTextureLoader.Release(imageAsset)` closes its bitmap
- `MaterialLoader.Load(descriptor, { GetDependency })` requires a material source and gets its base-color texture through the declared dependency accessor

## Render preparation

- `RenderSystem` requires a renderer with `SetRenderItems()`
- It requires the active camera entity to have `Camera` and `Transform`
- It calculates the camera view from the camera's `WorldMatrix`
- For each entity with `Transform` and `MeshRenderer`, it sends the mesh handle, material handles by slot, and world matrix to the renderer
- A missing active camera or camera component causes render preparation to throw

## WebGPU setup and frame rendering

| Member | Behaviour |
| --- | --- |
| `Initialize()` | Requests a WebGPU adapter and device, configures the canvas, loads WGSL, and creates the pipeline and shared resources |
| `SetRenderItems(renderItems, viewMatrix, projectionMatrix)` | Validates input, uploads transform matrices, and sends active resource data to the GPU resource cache |
| `WebGpuResourceCache.GetMeshResource()` / `GetTextureResource()` / `GetMaterialBindGroup()` | Return cached resources or create and upload a GPU resource on the first request |
| `WebGpuResourceCache.Prune()` / `Dispose()` | Release GPU resources that are no longer used or when the renderer shuts down |
| `EnsureDepthTexture()` | Creates or resizes the depth attachment to match the canvas |
| `Render()` | Clears the color and depth attachments, draws each submesh, and submits the command buffer |
| `GpuTimingTracker.Initialize(device)` / `Destroy()` | Creates timestamp resources when supported and releases them on device loss or shutdown |
| `GpuTimingTracker.BeginFrame()` | Reserves a timing slot or returns `null` when timing is unavailable |
| `Shutdown()` | Unconfigures the canvas and destroys cached buffers, textures, depth resources, and the device |

- Initialization rejects browsers without WebGPU, an adapter, or a WebGPU canvas context
- Each draw uses a triangle-list pipeline, per-draw model/view/projection matrices, and a material texture sampler
- The renderer draws one range per mesh submesh and selects the material by slot name
- GPU mesh, image texture, and material bind-group caches are keyed by loaded object identity
- `WebGpuResourceCache` owns mesh, texture, and material bind-group caches; the renderer supplies resource tracking and destruction callbacks
- Device loss is logged; later `Render()` calls throw with the device-loss message
- Call `Shutdown()` when the application stops owning the renderer

## Current scope

- The shader samples a base-color texture; it has no lighting, normals, shadowing, or physically based material model
- Mesh data uses non-indexed positions and UVs only
- The renderer draws the scene's render items and does not perform visibility culling or batching
- WGSL edits are not part of the asset hot-reload watcher

## Source

- `src/graphics/mesh.js`
- `src/graphics/material.js`
- `src/graphics/webgpu-renderer.js`
- `src/graphics/webgpu-resource-cache.js`
- `src/graphics/gpu-timing-tracker.js`
- `src/graphics/shaders/triangle.wgsl`
- `src/graphics/assets/builtin-mesh-loader.js`
- `src/graphics/assets/image-texture-loader.js`
- `src/graphics/assets/material-loader.js`
- `src/graphics/primitives/triangle.js`
- `src/graphics/primitives/cube.js`
- `src/graphics/primitives/plane.js`
- `src/graphics/primitives/sphere.js`
- `src/graphics/primitives/cylinder.js`
- `src/graphics/primitives/cone.js`
- `src/graphics/primitives/capsule.js`
- `src/graphics/primitives/primitive-utils.js`
- `src/systems/render-system.js`
