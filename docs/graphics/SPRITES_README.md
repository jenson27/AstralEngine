# Sprites

## Purpose

The sprite systems load sprite-sheet animation data, advance animation clips, and render sprites as camera-facing quads through WebGPU. They do not provide an animation authoring timeline or a 3D preview in the Asset Browser. See [Graphics](GRAPHICS_README.md), [Asset Registry](../core/ASSET_REGISTRY_README.md), and [Serialization](../serialization/SERIALIZATION_README.md) for related systems.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `SpriteRenderer()` / `SetSettings()` | Validates billboard mode, tint, and render order |
| `SpriteAnimator.SetAnimationHandle()` / `Update()` | Validates the animation asset and advances playback state |
| `SpriteAnimator.CurrentClipName` / `CurrentFrameIndex` / `LoopCount` | Exposes the current playback state |
| `SpriteAnimationAsset` | Validates and stores the texture, sprite grid, clips, and event mappings |
| `SpriteAnimationAsset.GetClip()` / `GetClipNames()` / `GetClipForEvent()` / `GetFrameUv()` / `GetActionTriggers()` | Looks up clips, events, and actions and calculates a frame's texture coordinates |
| `SpriteAnimationLoader.Load()` | Loads the animation JSON and resolves its declared texture dependency |
| `SpriteAnimationEventQueue.Enqueue()` / `Drain()` / `Clear()` | Queues, transfers, and clears animation events |
| `SpriteActionRegistry.Register()` / `Has()` / `Invoke()` | Stores and invokes named game action handlers |
| `SpriteAnimationSystem.Initialize()` / `FixedUpdate()` / `Shutdown()` | Advances active animators, dispatches frame actions, and clears queued events |
| `SpriteGameplayInputSystem.Initialize()` / `FixedUpdate()` | Converts the sample game's attack input into sprite animation events |
| `RenderSystem.PrepareRender()` | Builds and sorts sprite render items from active scene components |
| `WebGpuSpriteRenderer.Initialize()` / `SetRenderItems()` / `Draw()` | Creates the sprite pipeline, prepares quads, and draws them |
| `WebGpuSpriteRenderer.ActiveImages` / `Prune()` / `ClearRenderItems()` / `Dispose()` | Exposes and clears active texture state and releases renderer-owned resources |
| `CreateWebGpuSpritePipeline()` | Builds the WebGPU sprite pipeline and its bind group layouts |
| `SpriteRendererInspector` | Edits billboard mode, tint, and render order |
| `SpriteAnimatorInspector` | Edits the animation asset and initial clip |

## Ownership

- `SpriteAnimator` stores an animation asset handle and playback state; it does not acquire or release asset leases
- The scene asset scope retains the animation asset and its declared texture dependency
- `SpriteAnimationAsset` refers to the decoded texture supplied by `SpriteAnimationLoader`
- `WebGpuSpriteRenderer` owns its sprite pipeline, buffers, sampler, and texture bind groups
- The shared `WebGpuResourceCache` creates and releases the GPU texture resources used by sprites

## Asset data

- Register an animation with `typeId: "sprite-animation"` and `loaderId: "sprite:animation"`
- Set `source.kind` to `"sprite-animation"` and provide the JSON URL and `textureAssetId`
- Include that texture ID in the descriptor's `dependencies` array
- The animation JSON's `textureAssetId` must match the manifest source
- Animation definitions use version `1`

| Field | Meaning |
| --- | --- |
| `grid.frameWidth` / `frameHeight` | Sprite frame size in pixels |
| `grid.columns` | Number of frame columns |
| `grid.margin` / `spacing` | Optional pixel margins and gaps; both default to `[0, 0]` |
| `pixelsPerUnit` | Converts frame pixels to world-space size |
| `pivot` | Normalized frame origin, with each value from `0` to `1` |
| `defaultClip` | Name of the required fallback clip |
| `eventToClip` | Maps event names to clip names |
| `clips` | Maps clip names to playback settings and frame steps |

- The loader derives the number of rows from the decoded texture dimensions
- Frame indices are zero-based and follow row-major order
- A clip can define a frame range with `startFrame`, `endFrameExclusive`, and `frameRate`
- A clip can instead define explicit `frames` with a frame index and positive `durationMs` for each step
- Clip settings include `priority`, `loop`, `replayOnEvent`, and `returnToDefault`
- Frame steps and clips can define action triggers with an action name and JSON payload

## Scene data

- `spriteRenderer` is component version `1` and stores `billboardMode`, four-value `tint`, and `renderOrder`
- `billboardMode` accepts `"spherical"` or `"cylindrical"`; the default is `"spherical"`
- `tint` values must be between `0` and `1`; `renderOrder` must be finite
- `spriteAnimator` is component version `1` and stores `animationAssetId` plus optional `initialClip`
- The scene `assets` array must include each referenced animation asset ID
- A renderable sprite entity needs `Transform`, `SpriteRenderer`, and `SpriteAnimator`
- The editor requires `Transform` to add `SpriteRenderer`, and requires both `Transform` and `SpriteRenderer` to add `SpriteAnimator`

```json
{
  "typeId": "spriteRenderer",
  "version": 1,
  "data": {
    "billboardMode": "spherical",
    "tint": [1, 1, 1, 1],
    "renderOrder": 0
  }
}
```

```json
{
  "typeId": "spriteAnimator",
  "version": 1,
  "data": {
    "animationAssetId": "sprite-animation:example",
    "initialClip": "idle"
  }
}
```

## Animation events and actions

- `SpriteAnimationEventQueue.Enqueue()` requires a valid entity ID, a non-empty event name, and an object payload
- The queue JSON-clones event payloads; `Drain()` returns the current events and empties the queue
- `SpriteAnimator` starts on `initialClip` or the asset's default clip when it first updates
- An event with no `eventToClip` entry does not change playback
- An event switches clips only when the target clip has higher priority than the active clip
- An event for the current clip restarts it only when `replayOnEvent` is true
- At the end of a clip, playback loops, returns to the default clip, or stops according to the clip settings
- If hot reload removes the active clip, the animator logs a warning and switches to the asset's default clip
- Frame actions run after the active animators update for that fixed step
- `SpriteAnimationSystem` skips actions without registered handlers and logs a warning for missing handlers
- If an action handler throws, the system logs the error and continues
- The game registers action handlers through `RegisterSpriteActions()`; duplicate action names throw

## Rendering

- `RenderSystem` creates sprite render items only for active entities with `Transform`, `SpriteRenderer`, and `SpriteAnimator`
- The current animation frame selects the UV rectangle from the sprite sheet
- Frame dimensions and `pixelsPerUnit` set the sprite's world-space size; the entity's world scale adjusts that size
- Spherical billboards use the camera's right and up axes
- Cylindrical billboards face the camera around world up
- Sprites sort back-to-front, then by ascending `renderOrder`, then by entity ID
- `WebGpuSpriteRenderer` draws alpha-blended quads with nearest texture sampling
- Sprite fragments depth-test against scene geometry but do not write depth
- Sprite rendering uses no lighting
- The sample `SpriteGameplayInputSystem` queues an `"attack"` event for active entities with `PlayerControlled` and `SpriteAnimator`

## Current scope

- The animation format supports grid-based sprite sheets
- The sprite system does not provide an animation timeline or sprite-sheet editor
- The Asset Browser shows file metadata and does not preview sprites or animations
- The sprite pipeline does not provide lighting or 3D skeletal animation

## Source

- `src/components/graphics/sprite-renderer.js`
- `src/components/graphics/sprite-animator.js`
- `src/graphics/sprite-animation-asset.js`
- `src/graphics/assets/sprite-animation-loader.js`
- `src/graphics/webgpu-sprite-renderer.js`
- `src/graphics/webgpu-sprite-pipeline-builder.js`
- `src/graphics/shaders/sprite.wgsl`
- `src/systems/sprite-animation-system.js`
- `src/systems/sprite-animation-event-queue.js`
- `src/systems/sprite-action-registry.js`
- `src/systems/sprite-gameplay-input-system.js`
- `src/systems/render-system.js`
- `src/components/register-scene-components.js`
- `src/core/scene/scene-asset-references.js`
- `src/editor/component-authoring-catalog.js`
- `src/editor/component-authoring/sprite-animator-authoring.js`
- `src/editor/panels/inspector/components/sprite-renderer-inspector.js`
- `src/editor/panels/inspector/components/sprite-animator-inspector.js`
- `src/games/neutrophil-game.js`
- `src/browser/browser-application.js`
- `assets/animations/neutrophil.sprite-animation.json`
- `assets/asset-manifest.json`
- `assets/scenes/main.scene.json`
