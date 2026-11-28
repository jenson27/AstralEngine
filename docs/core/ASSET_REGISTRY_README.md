# Asset Registry

## Purpose

`AssetCatalog` stores immutable descriptors that identify assets, sources, loaders, and dependencies. `AssetLoaderRegistry` maps loader IDs to loader objects. They do not load or release assets; `AssetManager` owns that work. See [Asset Manager](ASSET_MANAGER_README.md) for loading and reload behavior.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `AssetCatalog` | Registers descriptors and looks them up by ID or local source path |
| `AssetLoaderRegistry` | Registers and looks up asset loader implementations |
| Asset descriptor | Declares one asset's type, loader, source data, version, and dependencies |
| `assets/asset-manifest.json` | Provides the current version 1 catalog data |

## Asset manifest

- The top-level record has `format: "astral-assets"`, `version: 1`, and an `assets` array
- Each descriptor has non-empty `id`, `typeId`, and `loaderId` strings
- `source` is JSON data copied and frozen by the catalog
- `version` must be a positive integer
- `dependencies` is optional and defaults to an empty array
- Dependency IDs must be non-empty and unique within a descriptor
- Asset IDs must be unique in the catalog and within a manifest
- Manifest registration validates all descriptors before registering any of them
- Dependency existence and cycles are checked by `AssetManager` when an asset is acquired or staged for reload
- A GLB model uses `typeId: "model"`, `loaderId: "gltf:glb"`, and `source: { "kind": "glb", "url": "..." }`; see [GLB Assets](../graphics/GLB_ASSETS_README.md)
- A sprite animation uses `typeId: "sprite-animation"`, `loaderId: "sprite:animation"`, `source.kind: "sprite-animation"`, and a declared texture dependency; see [Sprites](../graphics/SPRITES_README.md)

## Asset catalog API

| Member | Behaviour |
| --- | --- |
| `Register(descriptor)` | Registers one new descriptor; an existing ID throws |
| `RegisterManifest(manifest)` | Validates and registers a complete version 1 manifest |
| `Get(assetId)` / `Has(assetId)` | Returns a descriptor or checks whether its ID exists |
| `GetRequired(assetId)` | Returns a descriptor or throws for an unknown ID |
| `GetAll()` | Returns a new array of registered descriptors |
| `GetAssetIdsBySourcePath(sourcePath)` | Returns a frozen array of IDs whose local source URL maps to that path |

- Descriptor objects, their source objects, and dependency arrays are frozen
- Source-path lookup normalizes URL paths and slashes; invalid or cross-origin paths return no IDs
- A source without a usable `source.url` is not indexed by path

## Loader registry API

| Member | Behaviour |
| --- | --- |
| `Register(loaderId, loader)` | Stores a loader with `Load()` and optional `Release()` methods |
| `Get(loaderId)` / `Has(loaderId)` | Looks up a loader or checks registration |
| `GetRequired(loaderId)` | Returns a loader or throws for an unknown ID |

- Loader IDs must be non-empty and unique
- A provided `Release` member must be a function
- The registry does not check that a loader supports a descriptor's `typeId`; the loader validates its source when loading

## Ownership

- The application creates the catalog and loader registry, then passes them to `AssetManager`
- The catalog owns descriptor records; it does not own loaded asset objects
- The registry stores loader references and does not call them directly

## Current scope

- The manifest format is version `1`
- The catalog does not fetch manifests or watch files
- Asset hot reload maps local `source.url` paths to IDs; assets without a local URL need another reload trigger

## Source

- `src/core/assets/asset-catalog.js`
- `src/core/assets/asset-loader-registry.js`
- `assets/asset-manifest.json`
