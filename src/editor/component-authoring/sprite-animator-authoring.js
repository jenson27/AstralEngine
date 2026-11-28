import { SpriteAnimator } from "../../components/graphics/sprite-animator.js";
import { CreateElement } from "../ui/dom-utils.js";
import { CreateAssetSelectField } from "../ui/asset-select-field.js";

function GetAssetOptions(assetCatalog) {
    if (!assetCatalog || typeof assetCatalog.GetAll !== "function") {
        return [];
    }

    return assetCatalog
        .GetAll()
        .filter((descriptor) => descriptor.typeId === "sprite-animation")
        .map((descriptor) => [descriptor.id, descriptor.id]);
}

export function RenderSpriteAnimatorAddFields(
    container,
    { getAssetMetadata },
) {
    const options = GetAssetOptions(getAssetMetadata?.());
    const select = CreateAssetSelectField(
        container,
        "Sprite animation",
        options,
        { placeholderText: "Choose sprite animation" },
    );
    select.dataset.componentCreateField = "animationAssetId";
    select.required = true;
    select.disabled = options.length === 0;

    const hint = CreateElement("span", "inspector-authoring-hint");
    hint.textContent = options.length > 0
        ? "Choose a registered sprite animation asset."
        : "Add a sprite animation asset to the manifest before creating this component.";
    container.append(hint);
}

export async function CreateSpriteAnimator({
    acquireAssetHandle,
    getAssetMetadata,
    values,
}) {
    const animationAssetId = values?.animationAssetId;
    if (
        typeof animationAssetId !== "string" ||
        animationAssetId.trim() === ""
    ) {
        throw new TypeError("Choose a sprite animation asset.");
    }

    const assetCatalog = getAssetMetadata?.();
    if (!assetCatalog || typeof assetCatalog.GetRequired !== "function") {
        throw new Error("Asset catalog is not available.");
    }
    if (assetCatalog.GetRequired(animationAssetId).typeId !== "sprite-animation") {
        throw new TypeError(
            `Asset "${animationAssetId}" is not a sprite animation asset.`,
        );
    }
    if (typeof acquireAssetHandle !== "function") {
        throw new TypeError("Asset handle acquisition is not available.");
    }

    return new SpriteAnimator(await acquireAssetHandle(animationAssetId));
}
