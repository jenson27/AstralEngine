function GetMeshRendererDataReferences(data) {
    const references = [["meshAssetId", data?.meshAssetId]];

    if (data?.defaultMaterialAssetId !== undefined) {
        references.push([
            "defaultMaterialAssetId",
            data.defaultMaterialAssetId,
        ]);
        return references;
    }

    const materialsBySlot = data?.materialsBySlot;

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

        references.push([
            `materialsBySlot.${materialSlot}`,
            assetId,
        ]);
    }

    return references;
}

export function GetSceneAssetReferences(typeId, source = {}) {
    const { data, component, state } = source;
    const hasRuntimeSource =
        component !== undefined || state !== undefined;

    if (typeId === "modelRenderer") {
        if (!hasRuntimeSource) {
            return [["modelAssetId", data?.modelAssetId]];
        }

        const modelHandle =
            state?.modelHandle ?? component?.ModelHandle;

        return modelHandle
            ? [["modelAssetId", modelHandle.AssetId]]
            : [];
    }

    if (typeId === "meshRenderer") {
        if (!hasRuntimeSource) {
            return GetMeshRendererDataReferences(data);
        }

        const meshHandle =
            state?.meshHandle ?? component?.MeshHandle;

        if (!meshHandle) {
            return [];
        }

        const materialHandlesBySlot =
            state?.materialHandlesBySlot ??
            component.MaterialHandlesBySlot;

        return [
            ["meshAssetId", meshHandle.AssetId],
            ...Object.entries(materialHandlesBySlot).map(
                ([materialSlot, handle]) => [
                    `materialsBySlot.${materialSlot}`,
                    handle.AssetId,
                ],
            ),
        ];
    }

    if (typeId === "spriteAnimator") {
        if (!hasRuntimeSource) {
            return [["animationAssetId", data?.animationAssetId]];
        }
        const animationHandle =
            state?.animationHandle ?? component?.AnimationHandle;
        return animationHandle
            ? [["animationAssetId", animationHandle.AssetId]]
            : [];
    }

    return [];
}
