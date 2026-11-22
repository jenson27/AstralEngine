# GLB Assets

## Purpose

`GlbModelLoader` loads a static GLB model into the existing asset system. It supports triangle meshes, OPAQUE base-color materials, and embedded textures; it does not load animation or external GLTF resources. See [Asset Registry](../core/ASSET_REGISTRY_README.md), [Model Renderer](../components/graphics/MODEL_RENDERER_README.md), and [Graphics](GRAPHICS_README.md) for context.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `GlbModelLoader.Load()` | Fetches a GLB and coordinates parsing, scene building, and model asset creation |
| `GlbModelLoader.Release()` | Releases decoded image bitmaps owned by a loaded model |
| `ReadGlbContainer()` / `ReadBuffers()` | Reads and validates the GLB container and its embedded buffers |
| `DecodeDataUri()` / `GetBufferView()` / `RequireObject()` / `RequireIndex()` | Decodes embedded URI bytes and validates document references |
| `ReadPositions()` / `ReadUvs()` / `ReadIndices()` | Decodes supported mesh accessors into typed arrays |
| `ValidateGlbDocument()` / `BuildGlbScene()` | Validates supported scene content and builds renderable primitives |
| `GlbImageDecoder.Decode()` / `Close()` / `Release()` | Decodes embedded images and releases their bitmaps |
| `ModelAsset` | Holds the model's primitive records and decoded image resources |
| `ModelAsset.MemoryUsageBytes` / `MemoryUsageEstimated` | Reports mesh bytes and estimated decoded bitmap bytes |
| `ModelRenderer` | Holds a stable model asset handle for scene rendering |
| `ModelRenderer` scene codec | Serializes and resolves a model asset ID using component version `1` |
| Asset Browser `glb` type | Filters and displays `.glb` file metadata |

## Registering a model

- Put the `.glb` file under `assets/`
- Add one descriptor to `assets/asset-manifest.json`
- The supplied `assets/models/Die6.glb` is registered as `model:die6`
- Keep the manifest version and descriptor version at `1`
- Reference the descriptor ID in the scene `assets` array and `modelRenderer` component
- No loader or renderer code changes are needed for another supported GLB file

```json
{
  "id": "model:example",
  "typeId": "model",
  "loaderId": "gltf:glb",
  "source": { "kind": "glb", "url": "/assets/models/example.glb" },
  "version": 1,
  "dependencies": []
}
```

```json
{
  "typeId": "modelRenderer",
  "version": 1,
  "data": { "modelAssetId": "model:example" }
}
```

## Supported content

- GLB container version `2` with glTF asset version `2.0`
- Default scene and node hierarchy with node matrix or translation, rotation, and scale
- Triangle-list primitives with `POSITION`, optional `TEXCOORD_0`, and optional unsigned 8, 16, or 32-bit indices
- Float positions and float or normalized unsigned byte or unsigned short UVs
- OPAQUE materials with `baseColorFactor` and optional `baseColorTexture`
- Embedded PNG or JPEG images in a buffer view or data URI
- Default sampler behavior, repeat wrapping, linear magnification, linear minification without mipmaps, and trilinear mipmapped minification
- The WebGPU renderer generates a mip chain for each decoded image during texture upload; the linear-only sampler clamps sampling to level zero
- Indexed triangle primitives retain their indices; each decoded mesh primitive is shared by nodes that reference the same glTF mesh
- Node hierarchy transforms are stored on each model primitive and applied during render preparation
- The WebGPU renderer samples the base-color texture and multiplies it by the material factor
- CPU memory reports exact position, UV, and index array bytes plus an estimate of `width × height × 4` bytes per decoded image
- The memory record is marked estimated when the model contains decoded images
- Active profiler capture records `GLB.Load:<asset ID>` as an async span and `ModelRenderer:<asset ID>` as a CPU render-preparation scope
- GPU timing remains measured for the render pass as a whole, not separately for each GLB

## Editor workflow

- The Asset Browser classifies `.glb` files as `glb`, filters them under `GLB models`, and displays file metadata without a 3D preview
- `RenderModelRendererAddFields()` offers registered descriptors with `typeId: "model"`; `CreateModelRenderer()` validates the selected descriptor and acquires its handle
- `ModelRendererInspector` lists registered model assets and validates and acquires a selected handle before applying the edit
- If no model asset options are available, `ModelRendererInspector` displays the current model asset ID as read-only
- `EditorSceneAssetTracker` retains IDs used by live components and undo or redo history in the active scene's asset scope

## Asset reload

- A changed `.glb` file under `assets/` can stage a replacement for a loaded model asset
- The hot-reload client commits ready replacements at a frame boundary before render preparation; the `ModelRenderer` keeps its stable handle and reads the replacement model
- The server watches `assets/`; JavaScript and WGSL source edits do not trigger asset reload
- See [Asset Manager](../core/ASSET_MANAGER_README.md) for the reload transaction and failure behavior

## Unsupported content and errors

- Animation, skinning, morph targets, vertex colors, Draco compression, non-triangle primitive modes, and non-OPAQUE material alpha modes fail with an asset-specific error
- External buffers and images, nonzero texture-coordinate sets, unsupported sampler settings, and unsupported required extensions fail with a clear error
- Required KHR_lights_punctual fails because the static renderer skips light nodes; optional camera and light nodes are skipped and logged as warnings
- Normals and other vertex attributes are not used; the current shader has no lighting
- Invalid headers, chunk lengths, JSON, accessors, image data, fetch responses, or decoded bitmaps reject the load
- `AssetManager` wraps loader failures with the asset ID and retains the loader error as `cause`; a failed load does not leave a loaded asset lease

## Current scope

- The loader uses the default GLB scene only
- The loader reads self-contained files and does not resolve external URIs
- Material support is limited to the base color data listed above; metallic, roughness, alpha, and lighting behavior are not rendered
- The Asset Browser displays GLB metadata but does not provide a 3D preview

## Source

- `src/graphics/assets/glb-model-loader.js`
- `src/graphics/assets/glb/glb-container-reader.js`
- `src/graphics/assets/glb/gltf-accessor-reader.js`
- `src/graphics/assets/glb/gltf-scene-builder.js`
- `src/graphics/assets/glb/glb-image-decoder.js`
- `src/graphics/model-asset.js`
- `src/graphics/webgpu-resource-cache.js`
- `src/graphics/shaders/mipmap.wgsl`
- `src/components/graphics/model-renderer.js`
- `src/components/register-scene-components.js`
- `src/systems/render-system.js`
- `src/browser-application.js`
- `src/editor/panels/asset-browser/asset-browser-model.js`
- `src/editor/panels/asset-browser/asset-browser-view.js`
- `src/editor/component-authoring-catalog.js`
- `src/editor/component-authoring/model-renderer-authoring.js`
- `src/editor/panels/inspector/components/model-renderer-inspector.js`
- `src/editor/editor-scene-asset-tracker.js`
- `server/asset-directory-api.cjs`
- `server.cjs`
- `assets/asset-manifest.json`
- `assets/models/Die6.glb`
