# Engine Documentation

## Start here

- Read the guide for the system you want to change
- See [the browser shell guide](SHELL_README.md) for page and startup context
- Guides describe the current source and data in this repository

## Core systems

- [Engine](core/ENGINE_README.md) - Frame timing and system scheduling
- [Entity Manager](core/ENTITY_MANAGER_README.md) - Entities, component storage, queries, and deferred changes
- [Scene Management](core/SCENE_MANAGEMENT_README.md) - Scene loading, switching, update, and cleanup
- [Transform Hierarchy](core/TRANSFORM_HIERARCHY_README.md) - Parent links, world matrices, and hierarchy changes
- [Input](core/INPUT_README.md) - Browser input events and named actions

## Assets

- [Asset Registry](core/ASSET_REGISTRY_README.md) - Asset descriptors, manifests, and loader registration
- [Asset Manager](core/ASSET_MANAGER_README.md) - Loading, dependency leases, scopes, and reloads

## Components

- [Transform](components/TRANSFORM_README.md) - Local transforms, interpolation, and world matrices
- [Camera](components/graphics/CAMERA_README.md) - Camera matrices and first-person camera controls
- [Directional Light](components/graphics/DIRECTIONAL_LIGHT_README.md) - Scene light data, editor settings, and render behavior
- [Mesh Renderer](components/graphics/MESH_RENDERER_README.md) - Mesh and material asset handles
- [Model Renderer](components/graphics/MODEL_RENDERER_README.md) - Static GLB model asset handles
- [Angular Velocity](components/ANGULAR_VELOCITY_README.md) - Angular rate data and its update system

## Other systems

- [Graphics](graphics/GRAPHICS_README.md) - Mesh data, materials, loaders, and the WebGPU renderer
- [GLB Assets](graphics/GLB_ASSETS_README.md) - Supported static GLB content and manifest setup
- [Serialization](serialization/SERIALIZATION_README.md) - Versioned records, JSON rules, and scene documents

## Editor

- [Editor Panels](editor/PANELS_README.md) - Panel registration, lifecycle, and built-in editor views
- [Inspector](editor/INSPECTOR_README.md) - Selected entity editing, component authoring, and undo/redo
- [Asset Browser](editor/ASSET_BROWSER_README.md) - Browses asset files and displays catalog metadata

## Diagnostics

- [Logging](diagnostics/LOGGING_README.md) - Log entries, sinks, and server log files
- [Profiler](diagnostics/PROFILER_README.md) - CPU scopes, frame metrics, and optional GPU timings
- [Memory Tracker](diagnostics/MEMORY_TRACKER_README.md) - Tracked resource estimates, frame events, and snapshots
