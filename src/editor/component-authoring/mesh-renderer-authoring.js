import { MeshRenderer } from "../../components/graphics/mesh-renderer.js";
import { CreateElement } from "../ui/dom-utils.js";
import { CreateAssetSelectField } from "../ui/asset-select-field.js";

function GetAssetOptions(assetCatalog, assetType) {
    if (!assetCatalog || typeof assetCatalog.GetAll !== "function") {
        return [];
    }

    return assetCatalog
        .GetAll()
        .filter((descriptor) => descriptor.typeId === assetType)
        .map((descriptor) => {
            const sourceLabel = descriptor.source?.name ?? descriptor.id;
            return [descriptor.id, `${descriptor.id} (${sourceLabel})`];
        });
}

function RenderAssetSelect(container, labelText, fieldId, options) {
    const select = CreateAssetSelectField(
        container,
        labelText,
        options,
        { placeholderText: `Choose ${labelText.toLowerCase()}` },
    );
    select.dataset.componentCreateField = fieldId;
    select.required = true;
    select.disabled = options.length === 0;
}

export function RenderMeshRendererAddFields(
    container,
    { getAssetMetadata },
) {
    const assetCatalog = getAssetMetadata?.();
    const meshOptions = GetAssetOptions(assetCatalog, "mesh");
    const materialOptions = GetAssetOptions(assetCatalog, "material");
    RenderAssetSelect(
        container,
        "Mesh asset",
        "meshAssetId",
        meshOptions,
    );
    RenderAssetSelect(
        container,
        "Material for all slots",
        "materialAssetId",
        materialOptions,
    );

    if (meshOptions.length === 0 || materialOptions.length === 0) {
        const hint = CreateElement("span", "inspector-authoring-hint");
        hint.textContent =
            "Mesh Renderer needs at least one mesh asset and one material asset.";
        container.append(hint);
        return;
    }

    const hint = CreateElement("span", "inspector-authoring-hint");
    hint.textContent =
        "The selected material is assigned to every mesh slot. You can edit slots after adding it.";
    container.append(hint);
}

export async function CreateMeshRenderer({
    acquireAssetHandle,
    getAssetMetadata,
    values,
}) {
    const meshAssetId = values?.meshAssetId;
    const materialAssetId = values?.materialAssetId;
    if (
        typeof meshAssetId !== "string" ||
        meshAssetId === "" ||
        typeof materialAssetId !== "string" ||
        materialAssetId === ""
    ) {
        throw new TypeError("Choose both a mesh asset and a material asset.");
    }

    const assetCatalog = getAssetMetadata?.();
    if (!assetCatalog || typeof assetCatalog.GetRequired !== "function") {
        throw new Error("Asset catalog is not available.");
    }
    if (typeof acquireAssetHandle !== "function") {
        throw new TypeError("Asset handle acquisition is not available.");
    }
    if (assetCatalog.GetRequired(meshAssetId).typeId !== "mesh") {
        throw new TypeError(`Asset "${meshAssetId}" is not a mesh asset.`);
    }
    if (assetCatalog.GetRequired(materialAssetId).typeId !== "material") {
        throw new TypeError(
            `Asset "${materialAssetId}" is not a material asset.`,
        );
    }

    const [meshHandle, materialHandle] = await Promise.all([
        acquireAssetHandle(meshAssetId),
        acquireAssetHandle(materialAssetId),
    ]);

    const materialHandlesBySlot = Object.fromEntries(
        meshHandle.Current.Submeshes.map(({ materialSlot }) => [
            materialSlot,
            materialHandle,
        ]),
    );
    if (Object.keys(materialHandlesBySlot).length === 0) {
        throw new Error("The selected mesh has no material slots.");
    }

    return new MeshRenderer(meshHandle, materialHandlesBySlot);
}
