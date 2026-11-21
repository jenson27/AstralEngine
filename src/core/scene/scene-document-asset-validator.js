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
            if (componentRecord.typeId !== "meshRenderer") {
                continue;
            }

            const assetReferences = GetMeshRendererAssetReferences(
                componentRecord.data,
            );

            for (const [field, assetId] of assetReferences) {
                if (
                    typeof assetId !== "string" ||
                    assetId.trim() === ""
                ) {
                    throw new TypeError(
                        `MeshRenderer ${field} must be a non-empty asset ID.`,
                    );
                }

                if (!declaredAssetIds.has(assetId)) {
                    throw new Error(
                        `MeshRenderer asset "${assetId}" is not listed in scene assets.`,
                    );
                }
            }
        }
    }
}

function GetMeshRendererAssetReferences(componentData) {
    const assetReferences = [
        ["meshAssetId", componentData?.meshAssetId],
    ];

    if (componentData?.defaultMaterialAssetId !== undefined) {
        assetReferences.push([
            "defaultMaterialAssetId",
            componentData.defaultMaterialAssetId,
        ]);
        return assetReferences;
    }

    AppendMaterialSlotAssetReferences(componentData, assetReferences);
    return assetReferences;
}

function AppendMaterialSlotAssetReferences(componentData, assetReferences) {
    const materialsBySlot = componentData?.materialsBySlot;

    if (
        !materialsBySlot ||
        typeof materialsBySlot !== "object" ||
        Array.isArray(materialsBySlot)
    ) {
        throw new TypeError(
            "MeshRenderer materialsBySlot must be an object.",
        );
    }

    const materialEntries = Object.entries(materialsBySlot);

    if (materialEntries.length === 0) {
        throw new TypeError(
            "MeshRenderer must define at least one material slot.",
        );
    }

    for (const [materialSlot, assetId] of materialEntries) {
        if (materialSlot.trim() === "") {
            throw new TypeError(
                "MeshRenderer material slot names must not be empty.",
            );
        }

        assetReferences.push([
            `materialsBySlot.${materialSlot}`,
            assetId,
        ]);
    }
}
