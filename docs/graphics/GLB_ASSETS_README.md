# GLB Assets

## Purpose

`GlbModelLoader` loads self-contained glTF 2.0 binary assets as static `ModelAsset` values through the asset manager. It owns parsing, validation, image decoding, and model cleanup. The renderer owns GPU upload and drawing. See [Asset Registry](../core/ASSET_REGISTRY_README.md), [Model Renderer](../components/graphics/MODEL_RENDERER_README.md), [Graphics](GRAPHICS_README.md), and [Directional Light](../components/graphics/DIRECTIONAL_LIGHT_README.md) for context.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `GlbModelLoader.Load()` | Fetches a GLB and coordinates container parsing, scene building, image decoding, and model creation |
| `GlbModelLoader.Release()` | Releases decoded image bitmaps owned by a loaded model |
| `ReadGlbContainer()` / `ReadBuffers()` | Validates the GLB container and reads embedded buffer data |
| `ReadPositions()` / `ReadNormals()` / `ReadUvs()` / `ReadColors()` / `ReadIndices()` | Reads interleaved, normalized, and sparse mesh accessors |
| `ValidateGlbDocument()` / `BuildGlbScene()` | Validates supported content and builds static render primitives |
| `GlbImageDecoder` | Decodes embedded PNG and JPEG images and releases their bitmaps |
| `Mesh` / `Material` / `ModelAsset` | Store vertex attributes, material data, primitives, and decoded images |
| `WebGPURenderer` / `triangle.wgsl` | Uploads mesh and texture resources and renders the static PBR slice |
| Asset Browser `glb` type | Searches and filters GLB files and displays file metadata |

## Registering and referencing a model

- Put the `.glb` file under `assets/`
- Add one descriptor to `assets/asset-manifest.json`
- Keep the manifest and descriptor versions at `1`
- Set optional `source.importScale` to a positive uniform scale; the default is `1`
- Add the model asset ID to the scene `assets` list and reference it from `modelRenderer`
- The scene loader acquires listed assets in its scene scope before component deserialization
- The model, embedded materials, and embedded textures load as one model asset; embedded materials are not separate catalog entries
- A supported GLB needs no loader or renderer code changes

```json
{
  "id": "model:example",
  "typeId": "model",
  "loaderId": "gltf:glb",
  "source": {
    "kind": "glb",
    "url": "/assets/models/example.glb",
    "importScale": 1
  },
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
- The selected default scene; if the document has no default scene, the loader selects scene `0`
- Node matrices or translation, rotation, and scale transforms, multiplied under the asset root `importScale`
- Static triangle lists, strips, and fans; strips and fans convert to triangle lists
- Float positions; float or normalized signed byte and short normals; generated normals when `NORMAL` is absent
- Float or normalized unsigned byte and short `TEXCOORD_0`, `TEXCOORD_1`, and `COLOR_0` data
- Unsigned byte, short, or integer indices
- Interleaved and sparse accessors with range, alignment, and index validation
- Metallic-roughness PBR factors and textures, plus base-color factors and textures
- Base-color textures use sRGB sampling; metallic-roughness textures use linear sampling. The green channel supplies roughness and the blue channel supplies metalness
- `OPAQUE` and `MASK` alpha modes, including `alphaCutoff`
- `KHR_materials_unlit`; unsupported optional extensions are ignored with a warning
- Embedded PNG and JPEG images in GLB buffer views or data URIs
- glTF repeat, clamp, and mirrored-repeat wrapping; nearest and linear filters; and the six core minification modes
- Scene lighting behavior is described in [Directional Light](../components/graphics/DIRECTIONAL_LIGHT_README.md); the renderer uses a default directional light when a scene has none
- Mesh data shared by nodes that reference the same glTF mesh
- CPU model memory estimates, decoded bitmap ownership, GPU resource tracking, and the `GLB.Load:<asset ID>` profiler span

## Unsupported content and errors

- Skinning attributes and nodes with skins fail the asset load
- Morph targets and mesh morph weights fail the asset load
- `BLEND` materials fail the asset load because transparent sorting is not supported
- Point and line primitive modes fail the asset load; texture-coordinate sets above `1` fail with a material-specific error
- External buffers and images fail the asset load; image decoding accepts embedded PNG and JPEG only
- Draco-compressed primitives fail the asset load
- Camera nodes, punctual-light nodes, and animations are skipped with warnings; use scene-owned lights
- Unknown required extensions fail with their names in the error; unsupported optional extensions are ignored with warnings
- Normal, occlusion, and emissive material properties are ignored with warnings
- Invalid headers, chunks, JSON, accessors, image bytes, fetch responses, or decoded bitmaps fail with an asset-specific error
- A failed load closes decoded images and does not register a partial model asset

## Asset Browser

- Lists `.glb` files as `GLB model`
- Filters files with the `GLB models` type option and searches by file name
- Shows each selected file's name, type, relative path, registration IDs, and file size
- Does not render a 3D preview

## Resource lifecycle

1. `GlbModelLoader.Load()` validates the descriptor and reads the GLB.
2. `ValidateGlbDocument()` checks extensions and supported document features.
3. `BuildGlbScene()` reads accessors, converts primitive topology, resolves materials, and applies `importScale` at the root.
4. `GlbImageDecoder` decodes images referenced by selected primitives.
5. `AssetManager` tracks the loaded `ModelAsset` and its estimated image memory.
6. `WebGPURenderer` creates vertex, index, uniform, and texture resources for active render items.
7. `GlbModelLoader.Release()` closes decoded images when the asset lease ends.

## Source

- `src/graphics/assets/glb-model-loader.js`
- `src/graphics/assets/glb/glb-container-reader.js`
- `src/graphics/assets/glb/gltf-accessor-reader.js`
- `src/graphics/assets/glb/gltf-scene-builder.js`
- `src/graphics/assets/glb/glb-image-decoder.js`
- `src/graphics/model-asset.js`
- `src/graphics/mesh.js`
- `src/graphics/material.js`
- `src/graphics/webgpu-resource-cache.js`
- `src/graphics/webgpu-pipeline-builder.js`
- `src/graphics/shaders/triangle.wgsl`
- `src/components/register-scene-components.js`
- `src/systems/render-system.js`
- `src/graphics/webgpu-renderer.js`
- `src/editor/component-authoring-catalog.js`
- `src/editor/panels/asset-browser/asset-browser-model.js`
- `src/editor/panels/asset-browser/asset-browser-view.js`
- `src/core/scene/scene-loader.js`
- `assets/asset-manifest.json`
- `assets/scenes/main.scene.json`
