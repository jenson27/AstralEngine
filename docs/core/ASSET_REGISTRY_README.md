# Asset Registry

## Purpose

The asset registry stores asset descriptors and maps loader IDs to loader objects. It validates this metadata but does not load or release assets. See [Asset Manager](ASSET_MANAGER_README.md) for asset loading and lifetime behavior.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `AssetCatalog.constructor()` | Creates an empty descriptor catalog. |
| `AssetCatalog.Register()` / `RegisterManifest()` | Validates and stores asset descriptors. |
| `AssetCatalog.Get()` / `GetRequired()` | Looks up an optional or required descriptor by ID. |
| `AssetCatalog.Has()` / `GetAll()` | Checks for an ID or returns registered descriptors. |
| `AssetLoaderRegistry.constructor()` | Creates an empty loader registry. |
| `AssetLoaderRegistry.Register()` | Validates and stores a loader by ID. |
| `AssetLoaderRegistry.Get()` / `GetRequired()` | Looks up an optional or required loader by ID. |
| `AssetLoaderRegistry.Has()` | Checks whether a loader ID is registered. |

## Asset manifest

- `AssetCatalog.RegisterManifest()` accepts an object with:
  - `format` - Must be `"astral-assets"`
  - `version` - Must be `1`
  - `assets` - An array of asset descriptors
- Each descriptor contains:
  - `id` - Unique asset ID
  - `typeId` - Asset type label
  - `loaderId` - Registered loader ID
  - `source` - JSON data passed to the loader
  - `version` - Positive integer
  - `dependencies` - Optional array of asset IDs; defaults to an empty array
- Dependency IDs must be non-empty strings and must not repeat in one descriptor.
- Registering a manifest validates every descriptor and checks for duplicate IDs before adding any of them.
- The catalog copies and freezes each source value as JSON data. It also freezes each descriptor and its dependency list.

```json
{
  "format": "astral-assets",
  "version": 1,
  "assets": [
    {
      "id": "texture:grass",
      "typeId": "texture",
      "loaderId": "image:texture",
      "source": {
        "kind": "image",
        "url": "/assets/textures/grass.jpg"
      },
      "version": 1,
      "dependencies": []
    }
  ]
}
```

## Registration and lookup

- `AssetCatalog.Register()` rejects a non-object descriptor, missing or blank string fields, a missing `source`, a non-positive version, or invalid dependencies.
- A descriptor ID cannot be registered more than once.
- `AssetCatalog.RegisterManifest()` rejects an invalid manifest format or version, duplicate IDs within the manifest, and IDs already in the catalog.
- `AssetCatalog.Get()` returns `undefined` for an unknown ID. `GetRequired()` throws for an unknown ID.
- `AssetCatalog.Has()` checks whether an ID exists. `GetAll()` returns an array of the registered frozen descriptors.
- `AssetLoaderRegistry.Register()` requires a non-empty loader ID and a loader with a `Load()` function.
- A loader may provide `Release()`. If it does, that value must be a function.
- Duplicate loader IDs are rejected. `Get()` returns `undefined` for an unknown ID; `GetRequired()` throws.

## Ownership

- `AssetCatalog` stores descriptors in a `Map`, keyed by asset ID.
- `AssetLoaderRegistry` stores loader references in a `Map`, keyed by loader ID.
- The catalog copies descriptor source data. Loaders and other callers cannot mutate the stored JSON data.
- The registry stores loader objects by reference. It does not create or destroy loaders.

## Current scope

- The catalog has no removal or update API.
- `AssetCatalog` stores metadata only. It does not instantiate assets.
- The browser startup code registers built-in mesh, image texture, and material loaders.
- See [Graphics](../graphics/GRAPHICS_README.md) for those loader implementations.

## Source

- `src/core/assets/asset-catalog.js`
- `src/core/assets/asset-loader-registry.js`
