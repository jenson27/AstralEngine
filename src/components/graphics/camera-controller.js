export function ValidateCameraControllerSettings(controller) {
    if (
        !Number.isFinite(controller.movementSpeed) ||
        controller.movementSpeed < 0 ||
        !Number.isFinite(controller.runMultiplier) ||
        controller.runMultiplier < 1 ||
        !Number.isFinite(controller.lookSensitivity) ||
        controller.lookSensitivity < 0 ||
        !Number.isFinite(controller.maxPitchRadians) ||
        controller.maxPitchRadians <= 0 ||
        controller.maxPitchRadians >= Math.PI / 2
    ) {
        throw new RangeError("Camera controller settings are invalid.");
    }
}

export class CameraController {
    constructor(settings) {
        if (!settings || typeof settings !== "object") {
            throw new TypeError(
                "CameraController requires settings from scene data.",
            );
        }

        this.movementSpeed = settings.movementSpeed;
        this.runMultiplier = settings.runMultiplier;
        this.lookSensitivity = settings.lookSensitivity;
        this.maxPitchRadians = settings.maxPitchRadians;

        ValidateCameraControllerSettings(this);
    }
}
