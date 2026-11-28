# AstralEngine: architecture and runtime flow {#astralengine-overview}

AstralEngine runs its engine logic as browser JavaScript and renders through WebGPU. Node.js serves the project. The game and editor entries share one browser runtime: `BrowserApplication` wires startup dependencies, while `BrowserRuntime` owns lifecycle and frame callbacks. JSON scenes become scene-owned ECS data and produce render items each frame.[](source:ref-game-page)[](source:ref-server)[](source:ref-app-setup)[](source:ref-browser-runtime)

- `src/main.js` starts the game runtime. `src/editor/main.js` starts the editor runtime and mounts its tools.[](source:ref-game-entry)[](source:ref-editor-entry)
- `BrowserApplication` creates the platform and renderer, then starts `BrowserRuntime`.[](source:ref-app-setup)[](source:ref-browser-runtime)
- Scene documents, asset manifests, input maps, and built-in component records stay at version 1.[](source:ref-scene-v1)[](source:ref-assets-v1)[](source:ref-input-v1)[](source:ref-codecs-v1)

@answer scope="Current local-only working-tree snapshot · browser runtime · version 1 data contracts"
@meta locale=en quality_profile=showcase style=product repo_url=https://github.com/jenson27/AstralEngine.git repo_revision=a2fa702aa8803508e5af88829874d7eda4ec5042 repo_link_mode=local-only

@source ref-project title="Project overview" path=README.md lines=1:16
@source ref-game-page title="Game browser page" path=index.html lines=1:17
@source ref-editor-page title="Editor browser page" path=editor.html lines=1:22
@source ref-game-entry title="Game entry module" path=src/main.js lines=1:30
@source ref-editor-entry title="Editor entry module" path=src/editor/main.js lines=1:137
@source ref-app-setup title="Browser application wiring" path=src/browser/browser-application.js lines=40:104
@source ref-app-start title="Game and editor startup APIs" path=src/browser/browser-application.js lines=107:120
@source ref-browser-runtime title="Browser runtime lifecycle and frame callbacks" path=src/browser/browser-runtime.js lines=144:223
@source ref-browser-assets title="Browser asset runtime" path=src/browser/browser-asset-runtime.js lines=22:64
@source ref-browser-scene-runtime title="Browser scene setup" path=src/browser/browser-scene-runtime.js lines=15:106
@source ref-platform title="Browser canvas platform" path=src/platform/browser-platform.js lines=5:58
@source ref-input title="Input map and action manager" path=src/core/input/input-manager.js lines=37:133
@source ref-server title="Local HTTP server" path=server.cjs lines=359:442
@source ref-server-api title="Asset directory API" path=server/asset-directory-api.cjs lines=186:211
@source ref-scene-loader title="Scene fetch, validation, and asset acquisition" path=src/core/scene/scene-loader.js lines=32:120
@source ref-scene-builder title="Scene and ECS construction" path=src/core/scene/scene-builder.js lines=10:108
@source ref-scene-manager title="Scene sessions and activation" path=src/core/scene/scene-manager.js lines=99:170
@source ref-scene-phases title="Scene update phases" path=src/core/scene/scene.js lines=224:272
@source ref-system-scheduler title="System phase scheduler" path=src/core/scene/system-scheduler.js lines=1:89
@source ref-engine-config title="Fixed-step timing configuration" path=src/core/engine.js lines=60:62
@source ref-engine-loop title="Fixed update callback scheduling" path=src/core/engine.js lines=194:216
@source ref-engine-render title="Prepare-render callback and renderer submission" path=src/core/engine.js lines=322:349
@source ref-ecs-create title="Entity creation" path=src/core/ecs/entity-manager.js lines=43:58
@source ref-ecs-component title="Component storage" path=src/core/ecs/entity-manager.js lines=230:255
@source ref-ecs-query title="Component queries" path=src/core/ecs/entity-manager.js lines=357:389
@source ref-render-system title="Render system preparation" path=src/systems/render-system.js lines=27:110
@source ref-renderer-init title="WebGPU renderer initialization" path=src/graphics/webgpu-renderer.js lines=74:120
@source ref-renderer-prepare title="WebGPU draw-item preparation" path=src/graphics/webgpu-renderer.js lines=208:330
@source ref-renderer-submit title="WebGPU render pass submission" path=src/graphics/webgpu-renderer.js lines=459:525
@source ref-asset-catalog title="Version 1 asset manifest validation" path=src/core/assets/asset-catalog.js lines=19:44
@source ref-asset-scope title="Scene asset scopes" path=src/core/assets/asset-scope.js lines=19:57
@source ref-asset-manager title="Asset dependency loading" path=src/core/assets/asset-manager.js lines=515:578
@source ref-hot-reload-server title="Server asset watcher" path=server.cjs lines=211:270
@source ref-hot-reload-client title="Browser hot-reload events" path=src/core/hot-reload-client.js lines=83:119
@source ref-hot-reload-stage title="Staged asset reload" path=src/core/hot-reload-client.js lines=282:306
@source ref-hot-reload-commit title="Frame-boundary reload commit" path=src/core/hot-reload-client.js lines=134:160
@source ref-asset-commit title="Asset reload transaction" path=src/core/assets/asset-manager.js lines=321:355
@source ref-scene-v1 title="Version 1 scene document" path=assets/scenes/main.scene.json lines=1:8
@source ref-assets-v1 title="Version 1 asset manifest" path=assets/asset-manifest.json lines=1:5
@source ref-input-v1 title="Version 1 input map" path=assets/inputs/default.input-map.json lines=1:12
@source ref-codecs-v1 title="Version 1 scene component codecs" path=src/components/register-scene-components.js lines=38:259
@source ref-type-registry title="Per-type serializer versions and migrations" path=src/serialization/type-serializer-registry.js lines=92:155
@source ref-json title="JSON value parsing and encoding" path=src/serialization/json-format.js lines=134:168
@source ref-scene-adapter title="ECS scene document export" path=src/serialization/adapters/ecs-document-adapter.js lines=61:112
@source ref-editor-panels title="Editor panel registration" path=src/editor/register-editor-panels.js lines=8:71
@source ref-editor-authoring title="Editor scene authoring" path=src/editor/scene-authoring-controller.js lines=40:152
@source ref-editor-export title="Editor scene JSON export" path=src/editor/editor-scene-document-controller.js lines=264:298
@source ref-logger title="AstralLogger" path=src/diagnostics/logger.js lines=82:135
@source ref-profiler title="Profiler capture version" path=src/diagnostics/profiling/profiler.js lines=1:1
@source ref-memory title="Memory tracking" path=src/diagnostics/profiling/memory-tracker.js lines=147:213
@source ref-doc-index title="Engine documentation index" path=docs/SRC_README.md lines=1:33
@source ref-package title="Package scripts and version" path=package.json lines=1:24
@source ref-test title="Engine test entry" path=tests/engine.test.js lines=1:20
@source ref-glb title="GLB model loader" path=src/graphics/assets/glb-model-loader.js lines=1:80
@source ref-primitives title="Built-in primitive generators" path=src/graphics/primitives
@source ref-shaders title="WGSL shader modules" path=src/graphics/shaders
@source ref-math title="Matrix math" path=src/math/matrix4.js lines=1:50
@source ref-serialization title="Serialization package" path=src/serialization

## How does the full codebase fit together? {#architecture-panel span=12}

Node.js serves the game and editor pages and the project data. Both entries converge at `BrowserApplication`, which wires the shared runtime, platform, and WebGPU renderer. This map covers the major codebase modules; the runtime map below expands scene and frame coordination.[](source:ref-server)[](source:ref-game-page)[](source:ref-editor-page)[](source:ref-app-setup)[](source:ref-browser-runtime)

@diagram architecture id=architecture-map source=codebase-overview.architecture.json title="AstralEngine codebase architecture"

## What does BrowserRuntime coordinate? {#runtime-architecture-panel span=12}

This full-width map adds runtime modules, scene ownership, editor access, and the render path to the setup overview above. The sequence panel below shows their startup and frame order.

@diagram architecture id=runtime-details source=runtime-details.architecture.json title="Browser runtime and render path"

## How does startup data reach the GPU? {#flow-panel}

The browser loads `index.html` or `editor.html` from the local Node server, then runs the selected entry module.[](source:ref-game-page)[](source:ref-editor-page)[](source:ref-server) The entry initializes WebGPU, loads the V1 input map and asset manifest, and asks the scene loader to build the main scene.[](source:ref-app-start)[](source:ref-scene-loader) The scene loader acquires assets in a scene scope; the asset manager fetches GLB and texture dependencies.[](source:ref-asset-scope)[](source:ref-asset-manager)

The engine runs fixed updates at 1/60 second, with at most five steps per frame. It then prepares the scene and calls the WebGPU renderer.[](source:ref-engine-config)[](source:ref-engine-loop)[](source:ref-engine-render)

@sequence id=runtime-sequence title="Browser startup, scene load, and frame"
| actor flow-server | Local server | backend | source:ref-server |
| actor flow-app | Engine app | backend | source:ref-app-start |
| actor flow-scene | Scene/assets | backend | source:ref-scene-loader |
| actor flow-ecs | ECS | backend | source:ref-scene-builder |
| actor flow-render-system | Render system | backend | source:ref-render-system |
| actor flow-renderer | WebGPU | backend | source:ref-renderer-submit |
| actor flow-gpu | GPU | external | source:ref-renderer-submit |
| phase | Initialize runtime |
| flow-app | flow-renderer | `Initialize()` |
| flow-app | flow-server | Fetch input map and asset manifest |
| flow-server | flow-app | Version 1 JSON files | return |
| phase | Load the scene |
| flow-app | flow-scene | Load `/assets/scenes/main.scene.json` |
| flow-scene | flow-server | Fetch scene JSON |
| flow-server | flow-scene | Version 1 scene document | return |
| flow-scene | flow-server | Fetch GLB models and textures |
| flow-server | flow-scene | Asset responses | return |
| flow-scene | flow-ecs | Validate data, create entities, deserialize components |
| flow-scene | flow-app | Active scene ready | return |
| phase | Update and draw a frame |
| flow-app | flow-scene | Read input, then FixedUpdate |
| flow-scene | flow-ecs | Run fixed systems |
| flow-app | flow-scene | PrepareRender after reload commit |
| flow-scene | flow-ecs | Run transform and render systems |
| flow-ecs | flow-render-system | Query active camera and renderable entities |
| flow-render-system | flow-renderer | Items, camera, light |
| flow-engine | flow-renderer | `Render()` |
| flow-renderer | flow-gpu | Draw |

## Which contracts stay at version 1? {#contracts-panel}

Version 1 applies to the current persisted contracts and built-in component codecs. The serializer can migrate older per-type records, but the active built-in component registrations remain version 1.[](source:ref-type-registry)[](source:ref-codecs-v1)

| Record | Version 1 shape | Source |
| --- | --- | --- |
| Project package | `1.0.0` | [package metadata](source:ref-package) |
| Scene document | `astral-scene` with `version: 1` | [scene file](source:ref-scene-v1) |
| Asset manifest | `astral-assets` with `version: 1` | [asset catalog](source:ref-asset-catalog) |
| Input map | `version: 1` named actions | [action map](source:ref-input-v1) |
| Component record | `typeId`, `version`, and `data`; built-in codecs use `Version: 1` | [codecs](source:ref-codecs-v1), [serializer](source:ref-type-registry) |
| Profiler capture | `version: 1` | [profiler](source:ref-profiler) |

@callout id=v1-policy level=note title="V1 policy"
| Keep new project data and versioned contracts at version 1. The migration handler remains in place, but it does not require a version increase. |

The editor edits the active scene through its authoring controller. Its export path serializes the live scene and downloads a JSON copy; it does not overwrite the project asset. The panel registry includes hierarchy, inspector, asset browser, console, profiler, and memory tracking.[](source:ref-editor-authoring)[](source:ref-editor-export)[](source:ref-editor-panels)

The server also exposes a read-only asset-directory API. Its watcher sends asset-change events; the client stages replacement assets and commits them at a frame boundary.[](source:ref-server-api)[](source:ref-hot-reload-server)[](source:ref-hot-reload-stage)[](source:ref-hot-reload-commit)[](source:ref-asset-commit)

## Where does each module live? {#structure-panel}

The folder map groups code by runtime responsibility. The test suite uses Node’s built-in test runner, and the documentation index links to system guides.[](source:ref-package)[](source:ref-doc-index)

@tree id=project-tree title="AstralEngine folders and modules"
| tree-root | AstralEngine | - | source:ref-project |
| tree-shell | Browser pages and styles | tree-root | source:ref-game-page |
| tree-server | server.cjs | tree-root | source:ref-server |
| tree-server-api | server/ asset API | tree-server | source:ref-server-api |
| tree-src | src/ | tree-root | source:ref-doc-index |
| tree-platform | platform/ | tree-src | source:ref-platform |
| tree-core | core/ | tree-src | source:ref-scene-manager |
| tree-ecs | core/ecs/ | tree-core | source:ref-ecs-query |
| tree-scene | core/scene/ | tree-core | source:ref-scene-loader |
| tree-core-assets | core/assets/ | tree-core | source:ref-asset-manager |
| tree-input | core/input/ | tree-core | source:ref-input |
| tree-hot-reload | core/hot-reload-client.js | tree-core | source:ref-hot-reload-client |
| tree-components | components/ | tree-src | source:ref-codecs-v1 |
| tree-systems | systems/ | tree-src | source:ref-render-system |
| tree-graphics | graphics/ | tree-src | source:ref-renderer-init |
| tree-glb | graphics/assets/ GLB | tree-graphics | source:ref-glb |
| tree-primitives | graphics/primitives/ | tree-graphics | source:ref-primitives |
| tree-shaders | graphics/shaders/ WGSL | tree-graphics | source:ref-shaders |
| tree-math | math/ | tree-src | source:ref-math |
| tree-serialization | serialization/ | tree-src | source:ref-serialization |
| tree-editor | editor/ | tree-src | source:ref-editor-entry |
| tree-editor-panels | editor/panels/ and ui/ | tree-editor | source:ref-editor-panels |
| tree-diagnostics | diagnostics/ | tree-src | source:ref-logger |
| tree-assets | assets/ scenes, manifest, models, textures, input | tree-root | source:ref-assets-v1 |
| tree-tests | tests/ | tree-root | source:ref-test |
| tree-docs | docs/ | tree-root | source:ref-doc-index |
