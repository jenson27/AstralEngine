# Graphics

## Purpose

The graphics layer defines CPU-side meshes and materials, builds render items from scene components, and renders static PBR-lit geometry through WebGPU. It does not load scene JSON or choose the active scene; the scene and asset systems provide those inputs. See [Directional Light](../components/graphics/DIRECTIONAL_LIGHT_README.md), [Mesh Renderer](../components/graphics/MESH_RENDERER_README.md), [Model Renderer](../components/graphics/MODEL_RENDERER_README.md), [GLB Assets](GLB_ASSETS_README.md), and [Asset Manager](../core/ASSET_MANAGER_README.md) for context.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `Mesh` | Stores positions, normals, two UV sets, vertex colors, indices, and material-slot ranges |
| `Material` | Holds base-color and metallic-roughness textures, PBR factors, sampler settings, and alpha state |
| `ModelAsset` | Holds static mesh primitives, materials, and decoded images from one GLB |
| `DirectionalLight` | Stores normalized world-space direction, linear RGB color, and intensity |
| `RenderSystem.PrepareRender()` | Builds camera matrices and render items, then selects scene lighting |
| `WebGPURenderer` | Uploads mesh, material, and lighting data and submits render commands through WebGPU |
| `WebGpuResourceCache` | Creates, reuses, prunes, and releases GPU resources, including texture mip chains |
| `GpuTimingTracker` | Owns timestamp queries, readback buffers, and GPU frame timing |
| `BuiltinMeshLoader` | Creates a built-in primitive from an asset descriptor |
| `ImageTextureLoader` | Fetches and decodes an image and closes its bitmap on release |
| `MaterialLoader` | Builds a material from its declared texture dependency |
| `GlbModelLoader` | Loads static mesh primitives and base-color materials from a GLB file |
| `glb-container-reader.js` | Reads GLB container data and embedded buffers |
| `gltf-accessor-reader.js` | Decodes supported glTF mesh accessors |
| `gltf-scene-builder.js` | Builds renderable primitives from the supported default scene |
| `GlbImageDecoder` | Decodes embedded GLB image resources |
| `CreateTriangleMesh()` / `CreateCubeMesh()` / `CreatePlaneMesh()` | Create basic primitive meshes |
| `CreateSphereMesh()` / `CreateCylinderMesh()` / `CreateConeMesh()` / `CreateCapsuleMesh()` | Create parameterized primitive meshes |
| `primitive-utils.js` | Validates primitive parameters and builds triangle, radial, and cap data |
| `triangle.wgsl` | Transforms vertices and shades PBR materials with direct directional light |
| `mipmap.wgsl` | Samples each texture level to generate the next mip level |

## Mesh and material data

- `Mesh` takes `Float32Array` position data in XYZ triples and one UV pair per vertex; it may also take normals, a second UV set, vertex colors, and `Uint16Array` or `Uint32Array` indices
- Non-indexed vertex counts and indexed index counts must contain complete triangles; every index must point to an existing vertex
- The constructor copies positions, UVs, and indices; `GetPositions()`, `GetUVs()`, and `GetIndices()` return copies
- `Submeshes` is a frozen list of vertex ranges for non-indexed meshes or index ranges for indexed meshes
- Slot names must be unique and non-empty; submesh ranges must cover all draw data exactly once with no gaps or overlap
- If submeshes are omitted, the mesh has one `default` slot
- `Material` accepts optional base-color and metallic-roughness textures, base-color/metallic/roughness factors, sampler settings, UV set selection, `OPAQUE` or `MASK` alpha, and an unlit flag
- `ModelAsset.Primitives` contains `{ mesh, material, transform }` records; GLB node instances share mesh data and store their hierarchy transform on the primitive
- `ModelAsset.MemoryUsageBytes` estimates CPU mesh and decoded bitmap storage; `MemoryUsageEstimated` marks totals that include estimated image bytes

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
- `GlbModelLoader.Load(descriptor)` reads a self-contained GLB 2.0 file and returns a static `ModelAsset` with supported PBR materials; `Release()` closes its decoded images
- `GlbModelLoader` rejects unsupported static-model content with an asset-specific error; see [GLB Assets](GLB_ASSETS_README.md) for the supported slice

## Render preparation

- `RenderSystem` requires a renderer with `SetRenderItems()`
- It requires the active camera entity to have `Camera` and `Transform`
- It calculates the camera view from the camera's `WorldMatrix`
- It selects the first active `DirectionalLight`, or uses default lighting when the scene has none
- For each entity with `Transform` and `MeshRenderer`, it sends the mesh handle, material handles by slot, and world matrix to the renderer
- For each entity with `Transform` and `ModelRenderer`, it sends each model primitive with the entity world matrix composed with its primitive transform
- A missing active camera or camera component causes render preparation to throw

## WebGPU setup and frame rendering

| Member | Behaviour |
| --- | --- |
| `Initialize()` | Requests a WebGPU adapter and device, configures the canvas, loads WGSL, and creates the pipeline and shared resources |
| `SetRenderItems(renderItems, viewMatrix, projectionMatrix, lighting)` | Validates input, uploads frame and object uniform data, and sends active resource data to the GPU resource cache |
| `WebGpuResourceCache.GetMeshResource()` / `GetTextureResource()` / `GetMaterialBindGroup()` | Return cached resources or create and upload a GPU resource on the first request |
| `WebGpuResourceCache.Prune()` / `Dispose()` | Release GPU resources that are no longer used or when the renderer shuts down |
| `EnsureDepthTexture()` | Creates or resizes the depth attachment to match the canvas |
| `Render()` | Clears the color and depth attachments, draws each submesh, and submits the command buffer |
| `GpuTimingTracker.Initialize(device)` / `Destroy()` | Creates timestamp resources when supported and releases them on device loss or shutdown |
| `GpuTimingTracker.BeginFrame()` | Reserves a timing slot or returns `null` when timing is unavailable |
| `Shutdown()` | Unconfigures the canvas and destroys cached buffers, textures, depth resources, and the device |

- Initialization rejects browsers without WebGPU, an adapter, or a WebGPU canvas context
- Each draw uses a triangle-list pipeline, shared per-frame camera and light uniforms, per-draw model and normal matrices, and a material bind group
- Material bind groups carry base-color and metallic-roughness texture/sampler data and PBR factors; missing textures use shared fallback textures
- Image uploads generate a complete mip chain with linear mip filtering
- The renderer draws one range per mesh submesh and selects the material by slot name
- GPU mesh, image texture, and material bind-group caches are keyed by loaded object identity
- `WebGpuResourceCache` owns mesh, texture, and material bind-group caches; the renderer supplies resource tracking and destruction callbacks
- Device loss is logged; later `Render()` calls throw with the device-loss message
- Call `Shutdown()` when the application stops owning the renderer

## Current scope

- The shader supports direct Cook-Torrance PBR lighting with one directional light and ACES tone mapping for SDR output; it does not support ambient or image-based lighting, shadows, normal maps, emissive lighting, occlusion, or transparent blending
- The WebGPU renderer supports the static mesh and PBR material slice described in [GLB Assets](GLB_ASSETS_README.md)
- Mesh vertex attributes use `Float32Array`; draw data can be non-indexed or use `Uint16Array` or `Uint32Array` indices
- The renderer draws the scene's render items and does not perform visibility culling or batching
- WGSL edits are not part of the asset hot-reload watcher

## Source

- `src/graphics/mesh.js`
- `src/graphics/material.js`
- `src/graphics/model-asset.js`
- `src/graphics/webgpu-renderer.js`
- `src/graphics/webgpu-resource-cache.js`
- `src/graphics/webgpu-pipeline-builder.js`
- `src/graphics/gpu-timing-tracker.js`
- `src/graphics/shaders/triangle.wgsl`
- `src/graphics/shaders/mipmap.wgsl`
- `src/graphics/assets/builtin-mesh-loader.js`
- `src/graphics/assets/image-texture-loader.js`
- `src/graphics/assets/material-loader.js`
- `src/graphics/assets/glb-model-loader.js`
- `src/graphics/assets/glb/glb-container-reader.js`
- `src/graphics/assets/glb/gltf-accessor-reader.js`
- `src/graphics/assets/glb/gltf-scene-builder.js`
- `src/graphics/assets/glb/glb-image-decoder.js`
- `src/components/graphics/directional-light.js`
- `src/components/register-scene-components.js`
- `src/editor/component-authoring-catalog.js`
- `src/editor/panels/inspector/components/directional-light-inspector.js`
- `src/graphics/primitives/triangle.js`
- `src/graphics/primitives/cube.js`
- `src/graphics/primitives/plane.js`
- `src/graphics/primitives/sphere.js`
- `src/graphics/primitives/cylinder.js`
- `src/graphics/primitives/cone.js`
- `src/graphics/primitives/capsule.js`
- `src/graphics/primitives/primitive-utils.js`
- `src/systems/render-system.js`
