# AstralEngine

AstralEngine is a JavaScript 3D engine that runs in a browser. It uses an entity-component-system design, JSON scene and asset data, and WebGPU for rendering.

## Documentation

- [Engine documentation](docs/SRC_README.md) - Index to the system guides
- [Browser shell](docs/SHELL_README.md) - Browser page and startup context

## Requirements

- Node.js and npm
- A browser with WebGPU support
- The project uses PM2 as a development dependency to run the local server

## Install and run

From the repository root:

```powershell
npm install
npx pm2 start server.cjs --name astral-engine
```

Open [http://localhost:8000](http://localhost:8000) in a WebGPU-capable browser.
The local server serves the page and files from the repository and provides the engine's log and asset hot-reload endpoints.

View server output:

```powershell
npx pm2 logs astral-engine
```

Stop the server:

```powershell
npx pm2 stop astral-engine
```

## Tests

Run the test suite from the repository root:

```powershell
npm test
```

This runs the tests with Node.js's built-in test runner.
