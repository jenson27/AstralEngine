import { AssetCatalog } from "../core/assets/asset-catalog.js";
import { AssetLoaderRegistry } from "../core/assets/asset-loader-registry.js";
import { AssetManager } from "../core/assets/asset-manager.js";
import { BuiltinMeshLoader } from "../graphics/assets/builtin-mesh-loader.js";
import { ImageTextureLoader } from "../graphics/assets/image-texture-loader.js";
import { MaterialLoader } from "../graphics/assets/material-loader.js";
import { GlbModelLoader } from "../graphics/assets/glb-model-loader.js";
import { SpriteAnimationLoader } from "../graphics/assets/sprite-animation-loader.js";

async function FetchRequiredResponse(url, resourceName, signal) {
    const response = await fetch(url, { signal });

    if (!response.ok) {
        throw new Error(
            `Could not load ${resourceName}. HTTP ${response.status}.`,
        );
    }

    return response;
}

export async function CreateBrowserAssetRuntime({
    game,
    memoryTracker = null,
    profiler = null,
    signal = null,
}) {
    const manifestResponse = await FetchRequiredResponse(
        game.AssetManifestUrl,
        "asset manifest",
        signal,
    );
    const assetCatalog = new AssetCatalog();
    assetCatalog.RegisterManifest(await manifestResponse.json());

    const assetLoaderRegistry = new AssetLoaderRegistry();
    const fetcher = (url, options = {}) =>
        fetch(url, { ...options, signal: signal ?? options.signal });
    assetLoaderRegistry.Register(
        "builtin:mesh",
        new BuiltinMeshLoader(),
    );
    assetLoaderRegistry.Register(
        "image:texture",
        new ImageTextureLoader(fetcher),
    );
    assetLoaderRegistry.Register(
        "basic:material",
        new MaterialLoader(),
    );
    assetLoaderRegistry.Register(
        "gltf:glb",
        new GlbModelLoader(fetcher, undefined, undefined, profiler),
    );
    assetLoaderRegistry.Register(
        "sprite:animation",
        new SpriteAnimationLoader(fetcher),
    );

    return {
        catalog: assetCatalog,
        loaderRegistry: assetLoaderRegistry,
        manager: new AssetManager(
            assetCatalog,
            assetLoaderRegistry,
            memoryTracker,
        ),
    };
}
