import {
    DecodeDataUri,
    GetBufferView,
    RequireIndex,
    RequireObject,
} from "./glb-container-reader.js";

export class GlbImageDecoder {
    constructor(
        bitmapDecoder = globalThis.createImageBitmap?.bind(globalThis),
        blobFactory = (parts, options) => new Blob(parts, options),
    ) {
        if (bitmapDecoder !== undefined && typeof bitmapDecoder !== "function") {
            throw new TypeError("GLB image decoder must be a function.");
        }
        if (typeof blobFactory !== "function") {
            throw new TypeError("GLB image decoder requires a Blob factory.");
        }

        this._bitmapDecoder = bitmapDecoder;
        this._blobFactory = blobFactory;
    }

    async Decode(document, buffers, imageIndex) {
        if (!this._bitmapDecoder) {
            throw new Error("Embedded GLB textures require createImageBitmap support.");
        }

        const definitions = document.images ?? [];
        if (!Array.isArray(definitions)) {
            throw new TypeError("GLB images must be an array.");
        }
        const image = RequireObject(
            definitions[RequireIndex(imageIndex, definitions.length, "Image")],
            `Image ${imageIndex}`,
        );

        let bytes;
        let mimeType = image.mimeType;
        if (image.bufferView !== undefined) {
            const view = GetBufferView(
                document,
                buffers,
                image.bufferView,
                `Image ${imageIndex}`,
            );
            bytes = view.bytes;
        } else if (typeof image.uri === "string" && image.uri.startsWith("data:")) {
            const dataUri = DecodeDataUri(image.uri, `Image ${imageIndex}`);
            bytes = dataUri.bytes;
            mimeType = mimeType ?? dataUri.mimeType;
        } else {
            throw new Error(
                `Image ${imageIndex} uses an external resource, which this loader does not support.`,
            );
        }

        if (!["image/png", "image/jpeg"].includes(mimeType)) {
            throw new Error(`Image ${imageIndex} has an unsupported MIME type.`);
        }

        let bitmap;
        try {
            bitmap = await this._bitmapDecoder(
                this._blobFactory([bytes], { type: mimeType }),
                {
                    colorSpaceConversion: "none",
                    premultiplyAlpha: "none",
                },
            );
            if (
                !bitmap ||
                typeof bitmap.close !== "function" ||
                !Number.isSafeInteger(bitmap.width) ||
                bitmap.width <= 0 ||
                !Number.isSafeInteger(bitmap.height) ||
                bitmap.height <= 0
            ) {
                bitmap?.close?.();
                throw new TypeError("Image decoder returned an invalid bitmap.");
            }
        } catch (error) {
            throw new Error(`Could not decode embedded GLB image ${imageIndex}.`, {
                cause: error,
            });
        }

        return {
            bitmap,
            width: bitmap.width,
            height: bitmap.height,
        };
    }

    Close(images, onCloseError) {
        for (const image of images.values()) {
            try {
                image.bitmap.close();
            } catch (error) {
                onCloseError?.(error);
            }
        }
        images.clear();
    }

    Release(images) {
        const failures = [];
        for (const image of images) {
            try {
                image.bitmap.close();
            } catch (error) {
                failures.push(error);
            }
        }
        if (failures.length > 0) {
            throw new AggregateError(failures, "Could not release GLB model images.");
        }
    }
}
