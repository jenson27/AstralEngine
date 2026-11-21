# Asset Browser

## Purpose

`AssetBrowserPanel` loads directory data and coordinates the Asset Browser view. `AssetBrowserView` renders folders, files, filters, previews, and metadata. The browser reads files under `assets/`; it does not create, edit, move, or delete them. See [Asset Registry](../core/ASSET_REGISTRY_README.md) and [Editor Panels](PANELS_README.md) for context.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `AssetBrowserPanel.OnShow()` / `Refresh()` / `Dispose()` | Loads the current folder, ignores stale requests, and releases the view |
| `AssetBrowserView.RenderBreadcrumbs()` / `RenderEntries()` / `RenderDetails()` / `Dispose()` | Renders the browser UI and removes its event listeners |
| `AssetBrowserView.SetStatus()` / `SetRefreshDisabled()` / `SetEntryState()` | Updates loading, error, and entry state in the view |
| `ASSET_FILE_TYPE_OPTIONS` | Defines the file type filter options |
| `FilterAssetEntries()` | Filters file names and types while keeping folders visible |
| `GetAssetFileTypeLabel()` | Maps file types to display labels |
| `FormatAssetFileSize()` | Formats byte counts or reports an unknown size |
| `GetAssetFileUrl()` | Builds an encoded URL for an asset file |
| `/api/assets` | Lists one folder under `assets/` |
| `HandleAssetDirectoryRequest()` | Validates requests and returns directory data or an error |
| `AssetCatalog.GetAssetIdsBySourcePath()` / `GetAll()` | Finds registered assets for files and lists built-in assets |
| `src/editor/main.js` | Registers Asset Browser in the editor's right dock |

## Navigation and filtering

- The `Assets` breadcrumb returns to the root folder
- Clicking a folder opens it; breadcrumbs return to an ancestor folder
- Search matches file and folder names in the current folder without case sensitivity
- The type filter applies to files; folders stay visible
- Supported file types are images, audio, 3D models, scenes, data, shaders, and other files
- Scene files ending in `.scene.json` or `.editor-scene.json` use the scene type
- `Refresh` requests the current folder again without using a cached response
- When the panel becomes visible, `OnShow()` refreshes the current folder
- A newer request or a disposed panel ignores the result of an older request
- If a selected file is absent from the refreshed folder, the view clears that selection

## File details and catalog status

- Selecting a file shows its type, relative path, size, catalog status, and matching asset IDs
- Image files show an image preview; other file types show a type label
- If an image preview fails, the view shows an unavailable message
- Built-in assets with IDs that start with `builtin:` appear in the details view
- A file with no matching catalog IDs is labeled `Unregistered`
- If the catalog is unavailable, the browser cannot confirm registration; it may still show `Unregistered` and has no built-in asset list
- Invalid or missing size values display as `Unknown size`

## Directory API

- The panel sends `GET /api/assets?path=<relative path>`
- A successful response uses format `astral-asset-directory`, version `1`, and an `entries` array
- Each entry has a name, relative path, kind, type, and file size
- The server sorts folders before files and sorts names without case sensitivity
- The server rejects malformed paths with HTTP 400 and paths outside `assets/` with HTTP 403
- Missing folders return HTTP 404; inaccessible folders return HTTP 403
- Requests other than `GET` return HTTP 405; unexpected read failures return HTTP 500
- The server does not list symbolic links
- A failed request clears the entries and selected file, shows an error, and writes a warning to the logger

## Current scope

- The browser is read-only; it does not edit or manage files
- Only image files receive a visual preview
- File categories are inferred from extensions; unknown extensions use the `other` type

## Source

- `src/editor/panels/asset-browser/asset-browser-panel.js`
- `src/editor/panels/asset-browser/asset-browser-view.js`
- `src/editor/panels/asset-browser/asset-browser-model.js`
- `src/core/assets/asset-catalog.js`
- `src/editor/main.js`
- `server/asset-directory-api.cjs`
- `server.cjs`
