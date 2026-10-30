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
| `main.js`         | Starts the platform and renderer, then requests frames with `requestAnimationFrame()`. |
| `WebGPURenderer`  | Sets up WebGPU, loads the shader, creates a pipeline, and draws each frame.            |
| `triangle.wgsl`   | Defines the triangle’s vertex positions and fragment color.                            |
| `AstralLogger`    | Writes messages to the browser console and sends them to the server.                   |

## Startup flow

1. PM2 runs `server.cjs`.
2. The browser loads `index.html` from `localhost`.
3. `main.js` creates and starts `BrowserPlatform`.
4. `BrowserPlatform` sizes the canvas and watches for browser and display changes.
5. `WebGPURenderer` requests a GPU adapter and device, then configures the canvas.
6. The renderer loads `triangle.wgsl` and creates a render pipeline.
7. `main.js` requests frames. Each frame clears the canvas and draws the triangle.
8. `AstralLogger` writes startup or error messages to the console and server log.

## Canvas behavior

- The canvas drawing size follows its displayed size and the device pixel ratio.
- The device pixel ratio is capped at `2`.
- `BrowserPlatform.Stop()` disconnects its observers and event listeners.

## WebGPU render flow

1. The renderer gets the canvas texture for the current frame.
2. It starts a render pass and clears the canvas to a dark color.
3. It selects the triangle pipeline and draws three vertices.
4. It submits the commands to the GPU queue.

## Current scope

- The shader defines the three triangle positions directly. It does not use a vertex buffer yet.
- The render loop is in `main.js`; a separate engine loop is not implemented yet.
- The renderer does not yet have a camera, depth buffer, or 3D models.
- ECS and physics are not implemented yet.
