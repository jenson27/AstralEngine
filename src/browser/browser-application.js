// This module composes the browser runtime for the game and editor entry points.

import { BrowserPlatform } from "../platform/browser-platform.js";
import { BrowserInputSource } from "../platform/browser-input-source.js";
import { InputManager } from "../core/input/input-manager.js";
import { WebGPURenderer } from "../graphics/webgpu-renderer.js";
import { AstralLogger } from "../diagnostics/logger.js";
import { HotReloadClient } from "../core/hot-reload-client.js";
import { SpriteActionRegistry } from "../systems/sprite-action-registry.js";
import { CreateBrowserAssetRuntime } from "./browser-asset-runtime.js";
import { CreateBrowserSceneManager } from "./browser-scene-runtime.js";
import { BrowserRuntime } from "./browser-runtime.js";

async function FetchRequiredResponse(url, resourceName, signal) {
    const response = await fetch(url, { signal });

    if (!response.ok) {
        throw new Error(
            `Could not load ${resourceName}. HTTP ${response.status}.`,
        );
    }

    return response;
}

function ValidateGameDefinition(game) {
    if (
        !game ||
        typeof game.AssetManifestUrl !== "string" ||
        typeof game.InputMapUrl !== "string" ||
        typeof game.StartSceneUrl !== "string" ||
        typeof game.RegisterSceneTypes !== "function" ||
        typeof game.RegisterSpriteActions !== "function" ||
        typeof game.CreateSystems !== "function"
    ) {
        throw new TypeError("Browser application requires a valid game definition.");
    }
}

async function CreateRunningRuntime({
    canvas,
    status,
    game,
    profiler = null,
    memoryTracker = null,
    signal = null,
}) {
    ValidateGameDefinition(game);

    const platform = new BrowserPlatform(canvas);
    const renderer = new WebGPURenderer(
        canvas,
        memoryTracker,
        profiler,
    );
    const runtime = new BrowserRuntime({
        platform,
        renderer,
        startSceneUrl: game.StartSceneUrl,
        status,
        profiler,
        memoryTracker,
        signal,
        createRuntimeModules: async ({ platform, renderer, signal }) => {
            const [inputMapResponse, assetRuntime] = await Promise.all([
                FetchRequiredResponse(
                    game.InputMapUrl,
                    "input action map",
                    signal,
                ),
                CreateBrowserAssetRuntime({
                    game,
                    memoryTracker,
                    profiler,
                    signal,
                }),
            ]);
            const inputSource = new BrowserInputSource(platform.Canvas);
            const inputManager = new InputManager(
                inputSource,
                await inputMapResponse.json(),
            );
            const spriteActionRegistry = new SpriteActionRegistry();
            game.RegisterSpriteActions(spriteActionRegistry);
            const sceneManager = CreateBrowserSceneManager({
                renderer,
                inputManager,
                assetRuntime,
                spriteActionRegistry,
                game,
                signal,
            });

            return {
                inputSource,
                inputManager,
                assetRuntime,
                sceneManager,
            };
        },
    });

    await runtime.Start();
    return runtime;
}

export async function StartBrowserGame(options) {
    const runtime = await CreateRunningRuntime(options);
    return Object.freeze({
        Dispose: () => runtime.Dispose(),
    });
}

export async function StartBrowserEditor(options) {
    const runtime = await CreateRunningRuntime(options);
    return Object.freeze({
        ...runtime.GetEditorCapabilities(),
        Dispose: () => runtime.Dispose(),
    });
}
