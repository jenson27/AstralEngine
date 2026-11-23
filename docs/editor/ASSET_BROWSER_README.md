# Asset Browser

## Purpose

`AssetBrowserPanel` provides a read-only browser for files and folders under the project `assets/` directory. The `/api/assets` handler lists disk entries, and `AssetCatalog` supplies catalog metadata for project files. The browser does not modify files or list built-in engine assets. See [Asset Registry](../core/ASSET_REGISTRY_README.md) and [Editor Panels](PANELS_README.md) for context.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `AssetBrowserPanel.OnShow()` / `Refresh()` / `Dispose()` | Connects editor lifecycle events to directory state and the view |
| `AssetBrowserDirectoryState` | Owns folder listings, navigation state, refresh, errors, and retry recovery |
| `AssetBrowserDirectoryState.GetSnapshot()` | Returns entries and a render-ready folder tree without exposing internal maps |
| `AssetBrowserDirectoryState.Refresh()` / `SelectDirectory()` / `ToggleDirectory()` / `RetryDirectory()` | Refreshes folders and applies navigation and retry actions |
| `AssetBrowserDirectoryState.SelectFile()` / `SelectGridDirectory()` | Tracks the selected file or grid folder |
| `AssetBrowserDirectoryState._RefreshPaths()` | Refreshes expanded folders in parallel by depth, with parents before children |
| `AssetBrowserDirectoryState.Dispose()` | Invalidates pending results when the panel closes |
| `AssetBrowserPanel._GetCatalogAssetIds()` | Finds catalog IDs that refer to a project file |
| `AssetBrowserView.Render()` / `RenderBreadcrumbs()` / `RenderDetails()` | Renders browser state, selection, paths, and file details |
| `AssetBrowserView.SetStatus()` / `SetRefreshDisabled()` / `Dispose()` | Updates status and controls and removes view event listeners |
| `ASSET_FILE_TYPE_OPTIONS` / `FilterAssetEntries()` | Defines type filters and filters entries in the selected folder |
| `GetAssetFileTypeLabel()` / `FormatAssetFileSize()` / `GetAssetFileUrl()` | Formats file types and sizes and builds asset URLs |
| `GET /api/assets` / `HandleAssetDirectoryRequest()` | Lists direct entries under the asset root and returns version 1 errors |
| `src/editor/main.js` | Registers Asset Browser in the bottom dock |

## Ownership

- `AssetBrowserPanel` creates and owns one `AssetBrowserDirectoryState` and disposes it with the panel
- `AssetBrowserDirectoryState` owns directory-entry and request maps, expanded paths, errors, current path, and selection for its lifetime
- `AssetBrowserView` receives copied entries and a nested folder-tree snapshot; it does not read the directory state's maps or sets
- The panel borrows `AssetCatalog` through its getter; it does not dispose the catalog
- `AssetBrowserView` creates its DOM under the shell-provided root and removes its DOM and event listeners during `Dispose()`
- `AssetBrowserDirectoryState.Dispose()` invalidates pending request results; it does not abort the network requests

## Data details

### Directory response

- `format` - Response format identifier `astral-asset-directory`
- `version` - Response version `1`
- `path` - Normalized path under `assets/`; an empty string represents the root
- `entries` - Direct files and folders in the requested directory

### Directory entry

- `name` - File or folder name
- `relativePath` - Path relative to `assets/`, using `/` separators
- `kind` - `file` or `directory`
- `type` - File type inferred from its extension; directories use `folder`
- `sizeBytes` - File size in bytes; directories use `null`

## Dock and layout

- Asset Browser is the first bottom-dock tab, followed by Console, Profiler, and Memory Tracker
- Inspector is the only panel in the right dock
- The Asset Browser has a folder tree, asset grid, and details pane
- The panes use widths of 18% for the tree, 64% for the grid, and 18% for details
- Below 760px, the tree and grid stay side by side and the details pane moves below them
- The browser body scrolls vertically at narrow widths to keep all panes available in the short bottom dock

## Navigation and filtering

- `OnShow()` refreshes the root, expanded folders, and selected folder
- The `Assets` breadcrumb selects the root; other breadcrumbs select an ancestor folder
- Expanding a tree folder loads its direct child folders on demand
- Selecting a tree folder displays its contents in the grid
- A single click in the grid selects a file or folder
- A double-click or Enter on a grid folder opens that folder
- The tree disclosure button expands or collapses a folder
- Name search matches file and folder names in the selected folder without case sensitivity
- The type filter applies to files; folders remain visible
- Supported categories include images, audio, GLB models, other 3D models, scenes, data, shaders, and other files
- `.glb` files use the `glb` type; other supported model formats use `model`
- `.scene.json` and `.editor-scene.json` files use the `scene` type

## Refresh and errors

- `Refresh` reloads the root, expanded folders, and selected folder without using cached responses
- The panel refreshes when its tab becomes visible; it does not watch the file system in the background
- Newer requests and disposed panels ignore stale results
- If the selected folder was removed, the panel selects the nearest available ancestor and displays a message
- Inaccessible folders show an error in the tree or grid; expanded tree nodes provide a Retry action
- Retrying a folder reloads expanded descendants and the selected folder under it
- The Refresh button reloads the root, expanded folders, and selected folder
- A failed root request displays an error in the browser

## File details and previews

- Selecting a file shows its type, catalog status, matching asset IDs, relative path, and size
- Image files use lazy-loaded grid thumbnails and show a preview in the details pane
- If an image preview fails, the view shows an unavailable message
- Other file types use type labels; the browser does not render a 3D model preview
- Files with no matching catalog IDs show `Unregistered`
- If the catalog is unavailable, the browser may show `Unregistered` because it cannot confirm registration
- Unknown file types use the `other` type
- Invalid or missing file sizes display as `Unknown size`
- Built-in engine assets do not appear in the Asset Browser

## Directory API

- The panel sends `GET /api/assets?path=<relative path>`
- Successful responses use format `astral-asset-directory`, version `1`, and an `entries` array
- The server lists direct files and folders, sorts folders before files, and sorts names without case sensitivity
- The server normalizes and constrains paths to the asset root and does not list symbolic links
- Malformed paths return HTTP 400; paths outside the root return HTTP 403
- Missing folders return HTTP 404; inaccessible folders return HTTP 403
- Requests other than `GET` return HTTP 405; unexpected read failures return HTTP 500

## Current scope

- The browser is read-only; it does not create, edit, move, delete, or import files
- Search covers only the selected folder
- The browser does not watch the file system
- Only image files receive visual previews
- Built-in engine assets are not shown

## Source

- `src/editor/panels/asset-browser/asset-browser-panel.js`
- `src/editor/panels/asset-browser/asset-browser-directory-state.js`
- `src/editor/panels/asset-browser/asset-browser-view.js`
- `src/editor/panels/asset-browser/asset-browser-model.js`
- `src/core/assets/asset-catalog.js`
- `src/editor/main.js`
- `server/asset-directory-api.cjs`
- `server.cjs`
