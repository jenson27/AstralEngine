import { SpriteAnimator } from "../../../../components/graphics/sprite-animator.js";
import { CreateAssetSelectField } from "../../../ui/asset-select-field.js";
import {
    CreateFieldError,
    CreateReadOnlyField,
    CreateSelect,
} from "../field-controls.js";

const ASSET_FIELD_ID = "spriteAnimator.animationAssetId";
const CLIP_FIELD_ID = "spriteAnimator.initialClip";

function Render(container, { component, assetAccess }) {
    const assetOptions = assetAccess.GetOptions("sprite-animation");
    if (assetOptions.length > 0) {
        const select = CreateAssetSelectField(
            container,
            "Sprite animation",
            assetOptions,
            { selectedValue: component.AnimationHandle.AssetId },
        );
        select.dataset.inspectorField = ASSET_FIELD_ID;
        select.parentElement.append(CreateFieldError(ASSET_FIELD_ID));
    } else {
        CreateReadOnlyField(
            container,
            "Sprite animation",
            component.AnimationHandle.AssetId,
        );
    }

    const clipOptions = component.AnimationHandle.Current
        .GetClipNames()
        .map((clipName) => [clipName, clipName]);
    CreateSelect(
        container,
        "Initial clip",
        CLIP_FIELD_ID,
        component.InitialClip ?? "",
        [["", "Use asset default"], ...clipOptions],
    );
}

async function PrepareApply({ component, input, fieldId, assetAccess }) {
    if (fieldId === ASSET_FIELD_ID) {
        assetAccess.RequireType(input.value, "sprite-animation");
        const animationHandle = await assetAccess.AcquireHandle(input.value);
        const initialClip =
            component.InitialClip &&
            animationHandle.Current.GetClip(component.InitialClip)
                ? component.InitialClip
                : null;
        return {
            Commit() {
                component.SetAnimationHandle(animationHandle, initialClip);
            },
        };
    }

    if (fieldId === CLIP_FIELD_ID) {
        const initialClip = input.value || null;
        return {
            Commit() {
                component.SetAnimationHandle(
                    component.AnimationHandle,
                    initialClip,
                );
            },
        };
    }

    throw new Error("Unknown Sprite Animator field.");
}

function Capture(component) {
    return {
        animationHandle: component.AnimationHandle,
        initialClip: component.InitialClip,
    };
}

function RestoreInput({ component, input, fieldId }) {
    if (!input.isConnected) {
        return;
    }
    input.value = fieldId === ASSET_FIELD_ID
        ? component.AnimationHandle.AssetId
        : component.InitialClip ?? "";
}

function Sync({ component }) {
    return {
        [ASSET_FIELD_ID]: component.AnimationHandle.AssetId,
        [CLIP_FIELD_ID]: component.InitialClip ?? "",
    };
}

function AreStatesEqual(left, right) {
    return (
        left.animationHandle === right.animationHandle &&
        left.initialClip === right.initialClip
    );
}

function GetEditLabel(fieldId) {
    if (fieldId === ASSET_FIELD_ID) {
        return "Change sprite animation";
    }
    if (fieldId === CLIP_FIELD_ID) {
        return "Change sprite initial clip";
    }
    return `Edit ${fieldId}`;
}

export const SpriteAnimatorInspector = {
    title: "Sprite Animator",
    fieldPrefix: "spriteAnimator.",
    refreshOnChange: [ASSET_FIELD_ID],
    render: Render,
    prepareApply: PrepareApply,
    capture: ({ component }) => Capture(component),
    restore: ({ component, value }) =>
        component.SetAnimationHandle(value.animationHandle, value.initialClip),
    restoreInput: RestoreInput,
    sync: Sync,
    equals: AreStatesEqual,
    getEditLabel: GetEditLabel,
};

SpriteAnimatorInspector.componentType = SpriteAnimator;
