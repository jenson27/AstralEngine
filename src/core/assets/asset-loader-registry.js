export class AssetLoaderRegistry {
    constructor() {
        this._loadersById = new Map();
    }

    Register(loaderId, loader) {
        if (typeof loaderId !== "string" || loaderId.trim() === "") {
            throw new TypeError("Asset loader ID must be a non-empty string.");
        }

        if (!loader || typeof loader.Load !== "function") {
            throw new TypeError("Asset loader must provide a Load function.");
        }

        if (
            loader.Release !== undefined &&
            typeof loader.Release !== "function"
        ) {
            throw new TypeError(
                "Asset loader Release must be a function when provided.",
            );
        }

        if (this._loadersById.has(loaderId)) {
            throw new Error("Asset loader ID is already registered: " + loaderId);
        }

        this._loadersById.set(loaderId, loader);
    }

    Get(loaderId) {
        return this._loadersById.get(loaderId);
    }

    GetRequired(loaderId) {
        const loader = this.Get(loaderId);

        if (!loader) {
            throw new Error("Unknown asset loader ID: " + loaderId);
        }

        return loader;
    }

    Has(loaderId) {
        return this._loadersById.has(loaderId);
    }
}
