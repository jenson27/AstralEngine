import { GetSceneAssetReferences } from "./scene-asset-references.js";

export function ValidateSceneAssetIds(assetIds) {
    if (assetIds === undefined) {
        return;
    }

    if (!Array.isArray(assetIds)) {
        throw new TypeError("Scene assets must be an array.");
    }

    const seenAssetIds = new Set();

    for (const assetId of assetIds) {
        if (typeof assetId !== "string" || assetId.trim() === "") {
            throw new TypeError(
                "Scene asset IDs must be non-empty strings.",
            );
        }

        if (seenAssetIds.has(assetId)) {
            throw new Error("Duplicate scene asset ID: " + assetId);
        }

        seenAssetIds.add(assetId);
    }
}

export function ValidateSceneAssetReferences(data) {
    if (data.assets === undefined) {
        return;
    }

    const declaredAssetIds = new Set(data.assets);

    for (const entityData of data.entities) {
        for (const componentRecord of entityData.components) {
            const assetReferences = GetSceneAssetReferences(
                componentRecord.typeId,
                { data: componentRecord.data },
            );
            const typeName =
                componentRecord.typeId === "modelRenderer"
                    ? "ModelRenderer"
                    : "MeshRenderer";

            for (const [field, assetId] of assetReferences) {
                if (
                    typeof assetId !== "string" ||
                    assetId.trim() === ""
                ) {
                    throw new TypeError(
                        `${typeName} ${field} must be a non-empty asset ID.`,
                    );
                }

                if (!declaredAssetIds.has(assetId)) {
                    throw new Error(
                        `${typeName} asset "${assetId}" is not listed in scene assets.`,
                    );
                }
            }
        }
    }
}
