# Directional Light

## Purpose

`DirectionalLight` stores scene-owned data for one world-space directional light. `RenderSystem` selects the scene light and `WebGPURenderer` passes it to the shader. It does not provide ambient light, image-based lighting, or shadows. See [Graphics](../../graphics/GRAPHICS_README.md) and [GLB Assets](../../graphics/GLB_ASSETS_README.md) for context.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `DirectionalLight` | Stores a normalized direction, linear RGB color, and intensity |
| `register-scene-components.js` | Serializes and deserializes `directionalLight` component data as version 1 |
| `DirectionalLightInspector` | Edits light direction, color, and intensity in the editor |
| `RenderSystem.PrepareRender()` | Selects the first active light or uses default lighting |
| `WebGPURenderer.SetRenderItems()` | Uploads the selected light data once for the frame |
| `triangle.wgsl` | Applies direct Cook-Torrance lighting to lit materials |

## Light data

- `direction` - Non-zero world-space vector pointing from a surface toward the light; `DirectionalLight` normalizes it
- `color` - Three finite, non-negative linear RGB values
- `intensity` - Finite value greater than or equal to zero
- Defaults are direction `[0.4, 0.8, 0.45]`, color `[1, 1, 1]`, and intensity `3`
- Component data is serialized with `typeId: "directionalLight"` and `version: 1`

## Editing and validation

- Add the `Directional Light` component to an entity through the editor component authoring controls
- The Inspector shows `Direction to light (world space)`, `Color (linear)`, and `Intensity`
- `SetSettings()` validates all values before replacing the component settings
- A zero direction, invalid vector, negative color, or negative/non-finite intensity throws
- Direction and color getters return copies; callers cannot mutate the stored vectors through those getters

## Render behavior

- `RenderSystem.PrepareRender()` selects the first active `DirectionalLight` in the scene
- Other active directional lights are not combined
- If no active light exists, the renderer uses direction `[0.4, 0.8, 0.45]`, color `[1, 1, 1]`, and intensity `3`
- The shader combines direct light with the material's metallic-roughness values and surface normals
- The shader uses Cook-Torrance lighting with GGX distribution, Schlick geometry, and Schlick Fresnel
- `KHR_materials_unlit` materials bypass lighting
- Surfaces facing away from the light can be dark because the renderer has no ambient or environment fill

## Flow

1. Scene serialization creates the version 1 component through `register-scene-components.js`
2. Editor changes call `DirectionalLight.SetSettings()`
3. `RenderSystem.PrepareRender()` selects the first active light or the default
4. `WebGPURenderer.SetRenderItems()` copies the light values into the frame uniform data once
5. `triangle.wgsl` uses the light values when shading each material

## Current scope

- The renderer supports one directional light for the scene
- The light has no entity transform; its direction is stored in world space
- Ambient lighting, image-based lighting, shadows, and multiple-light accumulation are not supported

## Source

- `src/components/graphics/directional-light.js`
- `src/components/register-scene-components.js`
- `src/editor/component-authoring-catalog.js`
- `src/editor/panels/inspector/components/directional-light-inspector.js`
- `src/systems/render-system.js`
- `src/graphics/webgpu-renderer.js`
- `src/graphics/shaders/triangle.wgsl`
