import {
    CameraController,
    ValidateCameraControllerSettings,
} from "../../../../components/graphics/camera-controller.js";
import { CreateField } from "../field-controls.js";
import {
    AreDataValuesEqual,
    DegreesToRadians,
    RadiansToDegrees,
} from "../component-value-utils.js";

function CopySettings(controller) {
    return {
        movementSpeed: controller.movementSpeed,
        runMultiplier: controller.runMultiplier,
        lookSensitivity: controller.lookSensitivity,
        maxPitchRadians: controller.maxPitchRadians,
    };
}

function Render(container, { component }) {
    CreateField(
        container,
        "Movement speed",
        "cameraController.movementSpeed",
        component.movementSpeed,
    );
    CreateField(
        container,
        "Run multiplier",
        "cameraController.runMultiplier",
        component.runMultiplier,
    );
    CreateField(
        container,
        "Look sensitivity",
        "cameraController.lookSensitivity",
        component.lookSensitivity,
    );
    CreateField(
        container,
        "Maximum pitch (degrees)",
        "cameraController.maxPitchDegrees",
        RadiansToDegrees(component.maxPitchRadians),
    );
}

function Apply({ component, input, fieldId, readNumber }) {
    const settings = CopySettings(component);
    const property = fieldId.slice("cameraController.".length);
    const value = readNumber(input);
    if (property === "maxPitchDegrees") {
        settings.maxPitchRadians = DegreesToRadians(value);
    } else {
        settings[property] = value;
    }

    ValidateCameraControllerSettings(settings);
    component.SetSettings(settings);
}

function GetEditLabel(fieldId) {
    const labels = {
        "cameraController.movementSpeed": "Change camera movement speed",
        "cameraController.runMultiplier": "Change camera run multiplier",
        "cameraController.lookSensitivity": "Change camera look sensitivity",
        "cameraController.maxPitchDegrees": "Change camera pitch limit",
    };
    return labels[fieldId] ?? `Edit ${fieldId}`;
}

export const CameraControllerInspector = {
    title: "Camera Controller",
    fieldPrefix: "cameraController.",
    render: Render,
    apply: Apply,
    capture: ({ component }) => CopySettings(component),
    restore: ({ component, value }) => component.SetSettings(value),
    sync: ({ component }) => ({
        "cameraController.movementSpeed": component.movementSpeed,
        "cameraController.runMultiplier": component.runMultiplier,
        "cameraController.lookSensitivity": component.lookSensitivity,
        "cameraController.maxPitchDegrees": RadiansToDegrees(component.maxPitchRadians),
    }),
    equals: AreDataValuesEqual,
    getEditLabel: GetEditLabel,
};

CameraControllerInspector.componentType = CameraController;
