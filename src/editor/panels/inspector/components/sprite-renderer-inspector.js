import { SpriteRenderer } from "../../../../components/graphics/sprite-renderer.js";
import { AreDataValuesEqual } from "../component-value-utils.js";
import { CreateField, CreateSelect } from "../field-controls.js";

const FIELD_PREFIX = "spriteRenderer.";

function CopySettings(component) {
    return {
        billboardMode: component.billboardMode,
        tint: [...component.tint],
        renderOrder: component.renderOrder,
    };
}

function Render(container, { component }) {
    CreateSelect(
        container,
        "Billboard mode",
        `${FIELD_PREFIX}billboardMode`,
        component.billboardMode,
        [
            ["spherical", "Spherical"],
            ["cylindrical", "Cylindrical"],
        ],
    );

    for (const [index, channel] of ["Red", "Green", "Blue", "Alpha"].entries()) {
        CreateField(
            container,
            `Tint ${channel}`,
            `${FIELD_PREFIX}tint.${index}`,
            component.tint[index],
        );
    }

    CreateField(
        container,
        "Render order",
        `${FIELD_PREFIX}renderOrder`,
        component.renderOrder,
    );
}

function Apply({ component, input, fieldId, readNumber }) {
    const settings = CopySettings(component);
    const property = fieldId.slice(FIELD_PREFIX.length);
    if (property === "billboardMode") {
        settings.billboardMode = input.value;
    } else if (property === "renderOrder") {
        settings.renderOrder = readNumber(input);
    } else if (property.startsWith("tint.")) {
        const channel = Number(property.slice("tint.".length));
        if (!Number.isInteger(channel) || channel < 0 || channel >= 4) {
            throw new Error("Unknown Sprite Renderer field.");
        }
        settings.tint[channel] = readNumber(input);
    } else {
        throw new Error("Unknown Sprite Renderer field.");
    }

    component.SetSettings(settings);
}

function Sync({ component }) {
    return {
        [`${FIELD_PREFIX}billboardMode`]: component.billboardMode,
        ...Object.fromEntries(component.tint.map((value, index) => [
            `${FIELD_PREFIX}tint.${index}`,
            value,
        ])),
        [`${FIELD_PREFIX}renderOrder`]: component.renderOrder,
    };
}

function GetEditLabel(fieldId) {
    const labels = {
        [`${FIELD_PREFIX}billboardMode`]: "Change sprite billboard mode",
        [`${FIELD_PREFIX}renderOrder`]: "Change sprite render order",
        [`${FIELD_PREFIX}tint.0`]: "Change sprite red tint",
        [`${FIELD_PREFIX}tint.1`]: "Change sprite green tint",
        [`${FIELD_PREFIX}tint.2`]: "Change sprite blue tint",
        [`${FIELD_PREFIX}tint.3`]: "Change sprite alpha tint",
    };
    return labels[fieldId] ?? `Edit ${fieldId}`;
}

export const SpriteRendererInspector = {
    title: "Sprite Renderer",
    fieldPrefix: FIELD_PREFIX,
    render: Render,
    apply: Apply,
    capture: ({ component }) => CopySettings(component),
    restore: ({ component, value }) => component.SetSettings(value),
    sync: Sync,
    equals: AreDataValuesEqual,
    getEditLabel: GetEditLabel,
};

SpriteRendererInspector.componentType = SpriteRenderer;
