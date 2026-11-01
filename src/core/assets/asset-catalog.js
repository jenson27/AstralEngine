export class AssetCatalog {
    constructor() {
        this._descriptorsById = new Map();
    }

    Register(descriptor) {
        const normalizedDescriptor = this._CreateDescriptor(descriptor);

        if (this._descriptorsById.has(normalizedDescriptor.id)) {
            throw new Error(
                "Asset ID is already registered: " + normalizedDescriptor.id,
            );
        }

        this._descriptorsById.set(
            normalizedDescriptor.id,
            normalizedDescriptor,
        );
    }

    RegisterManifest(manifest) {
        if (
            !manifest ||
            typeof manifest !== "object" ||
            Array.isArray(manifest)
        ) {
            throw new TypeError("Asset manifest must be an object.");
        }

        if (
            manifest.format !== "astral-assets" ||
            manifest.version !== 1 ||
            !Array.isArray(manifest.assets)
        ) {
            throw new Error("Unsupported asset manifest format or version.");
        }

        const descriptors = manifest.assets.map((descriptor) =>
            this._CreateDescriptor(descriptor),
        );
        const idsInManifest = new Set();

        for (const descriptor of descriptors) {
            if (idsInManifest.has(descriptor.id)) {
                throw new Error(
                    "Duplicate asset ID in manifest: " + descriptor.id,
                );
            }

            if (this._descriptorsById.has(descriptor.id)) {
                throw new Error(
                    "Asset ID is already registered: " + descriptor.id,
                );
            }

            idsInManifest.add(descriptor.id);
        }

        for (const descriptor of descriptors) {
            this._descriptorsById.set(descriptor.id, descriptor);
        }
    }

    Get(assetId) {
        return this._descriptorsById.get(assetId);
    }

    GetRequired(assetId) {
        const descriptor = this.Get(assetId);

        if (!descriptor) {
            throw new Error("Unknown asset ID: " + assetId);
        }

        return descriptor;
    }

    Has(assetId) {
        return this._descriptorsById.has(assetId);
    }

    GetAll() {
        return Array.from(this._descriptorsById.values());
    }

    _CreateDescriptor(descriptor) {
        if (
            !descriptor ||
            typeof descriptor !== "object" ||
            Array.isArray(descriptor)
        ) {
            throw new TypeError("Asset descriptor must be an object.");
        }

        this._RequireString(descriptor.id, "Asset ID");
        this._RequireString(descriptor.typeId, "Asset type ID");
        this._RequireString(descriptor.loaderId, "Asset loader ID");

        if (!Object.hasOwn(descriptor, "source")) {
            throw new TypeError("Asset descriptor must define a source.");
        }

        if (
            !Number.isSafeInteger(descriptor.version) ||
            descriptor.version <= 0
        ) {
            throw new TypeError(
                "Asset version must be a positive integer.",
            );
        }

        const dependencies = descriptor.dependencies ?? [];

        if (!Array.isArray(dependencies)) {
            throw new TypeError("Asset dependencies must be an array.");
        }

        const normalizedDependencies = dependencies.map((dependency) => {
            this._RequireString(dependency, "Asset dependency ID");
            return dependency;
        });

        if (new Set(normalizedDependencies).size !== normalizedDependencies.length) {
            throw new Error("Asset dependencies must not contain duplicates.");
        }

        const source = JSON.parse(JSON.stringify(descriptor.source));
        const normalizedDescriptor = {
            id: descriptor.id,
            typeId: descriptor.typeId,
            loaderId: descriptor.loaderId,
            source,
            version: descriptor.version,
            dependencies: normalizedDependencies,
        };

        this._FreezeJson(normalizedDescriptor.source);
        Object.freeze(normalizedDescriptor.dependencies);

        return Object.freeze(normalizedDescriptor);
    }

    _RequireString(value, label) {
        if (typeof value !== "string" || value.trim() === "") {
            throw new TypeError(label + " must be a non-empty string.");
        }
    }

    _FreezeJson(value) {
        if (!value || typeof value !== "object" || Object.isFrozen(value)) {
            return;
        }

        for (const child of Object.values(value)) {
            this._FreezeJson(child);
        }

        Object.freeze(value);
    }
}
