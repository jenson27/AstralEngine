# AstralEngine

This repository contains the initial browser shell for AstralEngine.

## Documentation

### Start here

- [Engine Documentation](docs/ENGINE_README.md) - Index to the engine guides.

## Requirements

- Node.js
- A browser that supports WebGPU

The project currently has no third-party npm dependencies.

## Run locally

Open a terminal in the repository root and run:

1. Install Node.js.
2. Copy or clone this repository to the PC.
3. Open a terminal in the repository root.
4. Run `pm2 start server.cjs --name astral-engine`.
5. Open [http://localhost:8000](http://localhost:8000).

You do not need to run `npm install` for the current shell because it has no npm dependencies.

## npm packages

When the project gains npm packages, install them from the repository root. Replace `<package>` with the package's real name:

```powershell
npm install <package>
```

For a development tool, use:

```powershell
npm install --save-dev <package>
```

Commit both `package.json` and `package-lock.json`. On another PC, run `npm ci` to install the versions recorded in the lockfile.

From the repository root, start the server with PM2:

```powershell
pm2 start server.cjs --name astral-engine
```

View the server logs:

```powershell
pm2 logs astral-engine
```

Stop the server:

```powershell
pm2 stop astral-engine
```

## Tests

An automated test suite is not configured yet. The current `npm test` command is a placeholder and does not run tests.
