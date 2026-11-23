import { DirectionalLight } from "../../../../components/graphics/directional-light.js";
import { CreateField, CreateVectorFields } from "../field-controls.js";
import { AreDataValuesEqual } from "../component-value-utils.js";

function CopySettings(component) {
    return {
        direction: component.Direction,
        color: component.Color,
        intensity: component.Intensity,
    };
}

function Render(container, { component }) {
    CreateVectorFields(container, "Direction to light (world space)", component.Direction, "directionalLight.direction");
    CreateVectorFields(container, "Color (linear)", component.Color, "directionalLight.color");
    CreateField(container, "Intensity", "directionalLight.intensity", component.Intensity);
}

function Apply({ component, input, fieldId, readNumber }) {
    const settings = CopySettings(component);
    const propertyPath = fieldId.slice("directionalLight.".length).split(".");
    if (propertyPath.length === 2) {
        settings[propertyPath[0]][Number(propertyPath[1])] = readNumber(input);
    } else {
        settings[propertyPath[0]] = readNumber(input);
    }
    component.SetSettings(settings);
}

function Sync({ component }) {
    const settings = CopySettings(component);
    return {
        ...Object.fromEntries(settings.direction.map((value, index) => [
            `directionalLight.direction.${index}`,
            value,
        ])),
        ...Object.fromEntries(settings.color.map((value, index) => [
            `directionalLight.color.${index}`,
            value,
        ])),
        "directionalLight.intensity": settings.intensity,
    };
}

function GetEditLabel(fieldId) {
    return `Change ${fieldId.replace("directionalLight.", "directional light ").replaceAll(".", " ")}`;
}

export const DirectionalLightInspector = {
    title: "Directional Light",
    fieldPrefix: "directionalLight.",
    render: Render,
    apply: Apply,
    capture: ({ component }) => CopySettings(component),
    restore: ({ component, value }) => component.SetSettings(value),
    sync: Sync,
    equals: AreDataValuesEqual,
    getEditLabel: GetEditLabel,
};

DirectionalLightInspector.componentType = DirectionalLight;
