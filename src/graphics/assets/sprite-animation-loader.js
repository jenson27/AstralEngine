import { SpriteAnimationAsset } from "../sprite-animation-asset.js";

export class SpriteAnimationLoader {
    constructor(
        fetcher = globalThis.fetch?.bind(globalThis),
    ) {
        if (typeof fetcher !== "function") {
            throw new TypeError("SpriteAnimationLoader requires a fetch function.");
        }
        this._fetcher = fetcher;
    }

    async Load(descriptor, { GetDependency }) {
        if (descriptor.source?.kind !== "sprite-animation") {
            throw new TypeError("Sprite animation loader received an unsupported source.");
        }
        const textureAssetId = descriptor.source.textureAssetId;
        if (typeof textureAssetId !== "string" || !descriptor.dependencies.includes(textureAssetId)) {
            throw new TypeError("Sprite animation source must declare its texture dependency.");
        }
        const response = await this._fetcher(descriptor.source.url);
        if (!response.ok) {
            throw new Error(`Could not load sprite animation JSON. HTTP ${response.status}.`);
        }
        const definition = await response.json();
        if (definition.textureAssetId !== textureAssetId) {
            throw new Error("Sprite animation JSON textureAssetId must match its manifest source.");
        }
        return new SpriteAnimationAsset(
            definition,
            GetDependency(textureAssetId),
        );
    }

}
