# Engine Documentation

## Start here

This page is the documentation index for AstralEngine. Start with the shell guide to understand how the browser application starts and how it renders its first graphics.

## Core and platform

- [Shell Documentation](SHELL_README.md) - Describes the browser page, platform setup, WebGPU renderer, and first triangle.
- [Engine](core/ENGINE_README.md) - Describes the frame loop, fixed updates, and render callbacks.
- [Entity Manager](core/ENTITY_MANAGER_README.md) - Describes entities, component storage, queries, removal handlers, and deferred changes.
- [Scene Management](core/SCENE_MANAGEMENT_README.md) - Describes scene loading, system phases, updates, and disposal.

## Assets

- [Asset Registry](core/ASSET_REGISTRY_README.md) - Stores asset descriptors and maps loader IDs to loaders.
- [Asset Manager](core/ASSET_MANAGER_README.md) - Loads assets and manages dependencies, leases, and scopes.

## Components

- [Transform](components/TRANSFORM_README.md) - Describes local transform data and model-matrix generation.
- [Camera](components/graphics/CAMERA_README.md) - Describes camera settings and view/projection matrices.
- [Angular Velocity](components/ANGULAR_VELOCITY_README.md) - Describes angular-rate data and its update system.
- [Mesh Renderer](components/graphics/MESH_RENDERER_README.md) - Describes the mesh reference used for entity rendering.

## Graphics

- [Graphics](graphics/GRAPHICS_README.md) - Describes meshes, materials, graphics loaders, render preparation, and WebGPU resource lifetime.

## Serialization

- [Serialization](serialization/SERIALIZATION_README.md) - Describes type and component codecs, JSON rules, and scene documents.

## Diagnostics

- [Logging](diagnostics/LOGGING_README.md) - Describes log levels, entry data, output sinks, and server log files.
