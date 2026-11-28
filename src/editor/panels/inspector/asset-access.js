function GetAssetOptionLabel(descriptor) {
    const sourceLabel = descriptor.source?.name ?? descriptor.source?.kind;
    return sourceLabel
        ? `${descriptor.id} (${sourceLabel})`
        : descriptor.id;
}

export class InspectorAssetAccess {
    constructor(sceneManager, getAssetMetadata) {
        this._sceneManager = sceneManager;
        this._getAssetMetadata = getAssetMetadata;
    }

    GetOptions(assetType) {
        const catalog = this._getAssetMetadata?.();
        if (!catalog || typeof catalog.GetAll !== "function") {
            return [];
        }

        return catalog
            .GetAll()
            .filter((descriptor) => descriptor.typeId === assetType)
            .map((descriptor) => [
                descriptor.id,
                GetAssetOptionLabel(descriptor),
            ]);
    }

    RequireType(assetId, assetType) {
        const catalog = this._getAssetMetadata?.();
        if (!catalog || typeof catalog.GetRequired !== "function") {
            throw new Error("Asset catalog is not available.");
        }

        const descriptor = catalog.GetRequired(assetId);
        if (descriptor.typeId !== assetType) {
            throw new TypeError(
                `Asset "${assetId}" is not a ${assetType} asset.`,
            );
        }
    }

    AcquireHandle(assetId) {
        return this._sceneManager.AcquireAssetHandle(assetId);
    }
}
