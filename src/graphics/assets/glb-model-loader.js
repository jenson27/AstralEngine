import { AstralLogger } from "../../diagnostics/logger.js";
import { ProfileAsyncScope } from "../../diagnostics/profiling/profiler.js";
import { ModelAsset } from "../model-asset.js";
import { ReadBuffers, ReadGlbContainer } from "./glb/glb-container-reader.js";
import { GlbImageDecoder } from "./glb/glb-image-decoder.js";
import {
    BuildGlbScene,
    ValidateGlbDocument,
} from "./glb/gltf-scene-builder.js";

export class GlbModelLoader {
    constructor(
        fetcher = globalThis.fetch?.bind(globalThis),
        bitmapDecoder = globalThis.createImageBitmap?.bind(globalThis),
        blobFactory = (parts, options) => new Blob(parts, options),
        profiler = null,
    ) {
        if (typeof fetcher !== "function") {
            throw new TypeError("GlbModelLoader requires a fetch function.");
        }
        if (
            profiler !== null &&
            (typeof profiler.BeginAsyncScope !== "function" ||
                typeof profiler.EndAsyncScope !== "function")
        ) {
            throw new TypeError("GLB loader profiler does not support async scopes.");
        }

        this._fetcher = fetcher;
        this._imageDecoder = new GlbImageDecoder(bitmapDecoder, blobFactory);
        this._profiler = profiler;
    }

    async Load(descriptor) {
        const assetName = descriptor?.id ?? descriptor?.source?.url ?? "unknown";
        return ProfileAsyncScope(
            this._profiler,
            `GLB.Load:${assetName}`,
            () => this._Load(descriptor),
            "asset",
        );
    }

    async _Load(descriptor) {
        let stage = "validate descriptor";
        const images = new Map();
        try {
            if (
                !descriptor ||
                descriptor.source?.kind !== "glb" ||
                typeof descriptor.source.url !== "string" ||
                descriptor.source.url.trim() === ""
            ) {
                throw new TypeError(
                    "GLB model descriptor must define a non-empty source URL.",
                );
            }

            stage = "fetch GLB";
            const response = await this._fetcher(descriptor.source.url);
            if (!response?.ok) {
                throw new Error(
                    `Could not fetch GLB. HTTP ${response?.status ?? "unknown"}.`,
                );
            }

            stage = "read GLB container";
            const { document, binaryChunk } = ReadGlbContainer(
                await response.arrayBuffer(),
            );

            stage = "validate GLB content";
            ValidateGlbDocument(document);
            const buffers = ReadBuffers(document, binaryChunk);
            const primitives = await BuildGlbScene({
                document,
                buffers,
                loadImage: (imageIndex) =>
                    this._LoadImage(document, buffers, imageIndex, images),
                onWarning: (message, details) =>
                    AstralLogger.Warn(message, details),
            });
            const modelAsset = new ModelAsset(primitives, [...images.values()]);

            AstralLogger.Info("GLB model loaded.", {
                assetId: descriptor.id,
                url: descriptor.source.url,
                primitiveCount: modelAsset.Primitives.length,
                textureCount: modelAsset.Images.length,
            });
            return modelAsset;
        } catch (error) {
            const cause = error instanceof Error
                ? error
                : new Error(String(error));
            this._imageDecoder.Close(images, (closeError) =>
                AstralLogger.Warn(
                    "Could not release a decoded GLB image after load failure.",
                    closeError,
                ),
            );
            const assetName = descriptor?.id ?? descriptor?.source?.url ?? "unknown";
            AstralLogger.Error("GLB model load failed.", {
                assetId: descriptor?.id ?? null,
                url: descriptor?.source?.url ?? null,
                stage,
                error: cause.message,
            });
            throw new Error(
                `GLB asset "${assetName}" failed during ${stage}: ${cause.message}`,
                { cause },
            );
        }
    }

    async _LoadImage(document, buffers, imageIndex, images) {
        if (images.has(imageIndex)) {
            return images.get(imageIndex);
        }

        const imageAsset = await this._imageDecoder.Decode(
            document,
            buffers,
            imageIndex,
        );
        images.set(imageIndex, imageAsset);
        return imageAsset;
    }

    Release(modelAsset) {
        if (!(modelAsset instanceof ModelAsset)) {
            throw new TypeError("GlbModelLoader can only release ModelAsset values.");
        }

        this._imageDecoder.Release(modelAsset.Images);
    }
}
