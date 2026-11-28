import { ModelRenderer } from "../../components/graphics/model-renderer.js";
import { CreateElement } from "../ui/dom-utils.js";
import { CreateAssetSelectField } from "../ui/asset-select-field.js";

export function RenderModelRendererAddFields(
    container,
    { getAssetMetadata },
) {
    const assetCatalog = getAssetMetadata?.();
    const options = assetCatalog?.GetAll?.()
        .filter((descriptor) => descriptor.typeId === "model")
        .map((descriptor) => [descriptor.id, descriptor.id]) ?? [];
    const select = CreateAssetSelectField(
        container,
        "Model asset",
        options,
        { placeholderText: "Choose model asset" },
    );
    select.dataset.componentCreateField = "modelAssetId";
    select.required = true;
    select.disabled = options.length === 0;

    const hint = CreateElement("span", "inspector-authoring-hint");
    hint.textContent = options.length > 0
        ? "Choose a registered GLB model asset."
        : "Add a model asset to the manifest before creating this component.";
    container.append(hint);
}

export async function CreateModelRenderer({
    acquireAssetHandle,
    getAssetMetadata,
    values,
}) {
    const modelAssetId = values?.modelAssetId;
    if (typeof modelAssetId !== "string" || modelAssetId.trim() === "") {
        throw new TypeError("Choose a model asset.");
    }

    const assetCatalog = getAssetMetadata?.();
    if (!assetCatalog || typeof assetCatalog.GetRequired !== "function") {
        throw new Error("Asset catalog is not available.");
    }
    if (assetCatalog.GetRequired(modelAssetId).typeId !== "model") {
        throw new TypeError(`Asset "${modelAssetId}" is not a model asset.`);
    }
    if (typeof acquireAssetHandle !== "function") {
        throw new TypeError("Asset handle acquisition is not available.");
    }

    return new ModelRenderer(await acquireAssetHandle(modelAssetId));
}
