export class ImageTextureLoader {
    constructor(
        fetcher = globalThis.fetch?.bind(globalThis),
        bitmapDecoder =
            globalThis.createImageBitmap?.bind(globalThis),
    ) {
        if (typeof fetcher !== "function") {
            throw new TypeError(
                "ImageTextureLoader requires a fetch function.",
            );
        }

        if (typeof bitmapDecoder !== "function") {
            throw new TypeError(
                "ImageTextureLoader requires an image bitmap decoder.",
            );
        }

        this._fetcher = fetcher;
        this._bitmapDecoder = bitmapDecoder;
    }

    async Load(descriptor) {
        this._ValidateDescriptor(descriptor);

        const response = await this._fetcher(
            descriptor.source.url,
        );

        if (!response || !response.ok) {
            throw new Error(
                `Could not load image. HTTP ${response?.status ?? "unknown"}.`,
            );
        }

        const blob = await response.blob();
        const bitmap = await this._bitmapDecoder(blob);

        if (!bitmap || typeof bitmap.close !== "function") {
            throw new TypeError(
                "Image decoder returned an invalid bitmap.",
            );
        }

        if (
            !Number.isSafeInteger(bitmap.width) ||
            bitmap.width <= 0 ||
            !Number.isSafeInteger(bitmap.height) ||
            bitmap.height <= 0
        ) {
            bitmap.close();
            throw new TypeError(
                "Decoded image must have a valid width and height.",
            );
        }

        return {
            bitmap,
            width: bitmap.width,
            height: bitmap.height,
        };
    }

    Release(imageAsset) {
        if (
            !imageAsset?.bitmap ||
            typeof imageAsset.bitmap.close !== "function"
        ) {
            throw new TypeError(
                "Image texture asset has no closable bitmap.",
            );
        }

        imageAsset.bitmap.close();
    }

    _ValidateDescriptor(descriptor) {
        if (
            !descriptor ||
            typeof descriptor !== "object" ||
            descriptor.source?.kind !== "image"
        ) {
            throw new TypeError(
                "ImageTextureLoader requires an image source.",
            );
        }

        if (
            typeof descriptor.source.url !== "string" ||
            descriptor.source.url.trim() === ""
        ) {
            throw new TypeError(
                "Image source URL must be a non-empty string.",
            );
        }
    }
}
