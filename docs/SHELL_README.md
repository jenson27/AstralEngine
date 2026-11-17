# Shell Documentation

## Purpose

The browser shell starts AstralEngine, manages its canvas, and connects the browser to the first WebGPU renderer.

## Start here

See the [Engine Documentation](SRC_README.md) for the documentation index. See the [project README](../README.md) for requirements and server commands.

## Main parts and responsibilities

| Part              | Responsibility                                                                         |
| ----------------- | -------------------------------------------------------------------------------------- |
| `index.html`      | Creates the page, canvas, status message, and JavaScript entry point.                  |
| `style.css`       | Styles the page and makes the canvas fill the browser window.                          |
| `server.cjs`      | Serves project files and appends browser log entries to date-based files.              |
| `BrowserPlatform` | Watches browser size changes and resizes the canvas drawing area.                      |
| `main.js`         | Creates the platform, renderer, asset and scene services, then starts the engine.       |
| `Engine`          | Runs fixed updates, prepares rendering, and requests browser animation frames.          |
| `WebGPURenderer`  | Sets up WebGPU, loads the shader, creates a pipeline, and draws each frame.            |
| `triangle.wgsl`   | Transforms mesh vertices and samples a base-color texture.                             |
| `AstralLogger`    | Writes messages to the browser console and sends them to the server.                   |

## Startup flow

1. PM2 runs `server.cjs`.
2. The browser loads `index.html` from `localhost`.
3. `main.js` starts `BrowserPlatform`, which sizes the canvas and watches for size changes.
4. `WebGPURenderer` requests a GPU adapter and device, configures the canvas, and creates its pipeline.
5. `main.js` loads the input map and asset manifest, then creates the asset and scene services.
6. `SceneManager` loads the JSON scene and acquires its assets.
7. `Engine` runs fixed updates and render preparation on animation frames.
8. `AstralLogger` writes startup or error messages to the console and server log.

## Canvas behavior

- The canvas drawing size follows its displayed size and the device pixel ratio.
- The device pixel ratio is capped at `2`.
- `BrowserPlatform.Stop()` disconnects its observers and event listeners.

## WebGPU render flow

1. The renderer gets the canvas texture for the current frame.
2. It starts a render pass and clears the canvas to a dark color.
3. It draws each mesh submesh with its material and transform matrices.
4. It submits the commands to the GPU queue.

## Current scope

- The engine uses ECS entities, components, systems, JSON scenes, asset loading, and camera controls.
- The renderer supports cameras, depth testing, textured meshes, and built-in 3D primitives.
- The current shader does not use normals, lighting, or shadows.
- Physics and an in-engine debug inspector are not implemented yet.
