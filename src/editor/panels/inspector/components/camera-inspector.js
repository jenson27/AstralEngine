import {
    Camera,
    ValidateCameraSettings,
} from "../../../../components/graphics/camera.js";
import {
    CreateConditionalGroup,
    CreateField,
    CreateSelect,
} from "../field-controls.js";
import {
    AreDataValuesEqual,
    DegreesToRadians,
    RadiansToDegrees,
} from "../component-value-utils.js";

function CopySettings(camera) {
    return {
        projectionType: camera.projectionType,
        fieldOfView: camera.fieldOfView,
        orthographicSize: camera.orthographicSize,
        nearPlane: camera.nearPlane,
        farPlane: camera.farPlane,
    };
}

function Render(container, { component }) {
    CreateSelect(
        container,
        "Projection",
        "camera.projectionType",
        component.projectionType,
        [
            ["perspective", "Perspective"],
            ["orthographic", "Orthographic"],
        ],
    );

    const perspectiveFields = CreateConditionalGroup(
        container,
        "camera.projectionType",
        "perspective",
    );
    CreateField(
        perspectiveFields,
        "Field of view (degrees)",
        "camera.fieldOfViewDegrees",
        RadiansToDegrees(component.fieldOfView),
    );

    const orthographicFields = CreateConditionalGroup(
        container,
        "camera.projectionType",
        "orthographic",
    );
    CreateField(
        orthographicFields,
        "Vertical half-size",
        "camera.orthographicSize",
        component.orthographicSize,
    );
    CreateField(container, "Near plane", "camera.nearPlane", component.nearPlane);
    CreateField(container, "Far plane", "camera.farPlane", component.farPlane);
}

function Apply({ component, input, fieldId, readNumber }) {
    const settings = CopySettings(component);
    if (fieldId === "camera.projectionType") {
        settings.projectionType = input.value;
    } else if (fieldId === "camera.fieldOfViewDegrees") {
        settings.fieldOfView = DegreesToRadians(readNumber(input));
    } else {
        settings[fieldId.slice("camera.".length)] = readNumber(input);
    }

    ValidateCameraSettings(settings);
    component.SetSettings(settings);
}

function GetEditLabel(fieldId) {
    const labels = {
        "camera.projectionType": "Change camera projection",
        "camera.fieldOfViewDegrees": "Change camera field of view",
        "camera.orthographicSize": "Change camera orthographic size",
        "camera.nearPlane": "Change camera near plane",
        "camera.farPlane": "Change camera far plane",
    };
    return labels[fieldId] ?? `Edit ${fieldId}`;
}

export const CameraInspector = {
    title: "Camera",
    fieldPrefix: "camera.",
    refreshOnChange: ["camera.projectionType"],
    render: Render,
    apply: Apply,
    capture: ({ component }) => CopySettings(component),
    restore: ({ component, value }) => component.SetSettings(value),
    sync: ({ component }) => ({
        "camera.projectionType": component.projectionType,
        "camera.fieldOfViewDegrees": RadiansToDegrees(component.fieldOfView),
        "camera.orthographicSize": component.orthographicSize,
        "camera.nearPlane": component.nearPlane,
        "camera.farPlane": component.farPlane,
    }),
    equals: AreDataValuesEqual,
    getEditLabel: GetEditLabel,
    isEnabledToggleDisabled: ({ scene, entityId }) =>
        scene.ActiveCameraEntityId === entityId,
};

CameraInspector.componentType = Camera;
