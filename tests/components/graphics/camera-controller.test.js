import assert from "node:assert/strict";
import test from "node:test";
import { CameraController } from "../../../src/components/graphics/camera-controller.js";
import { CreateSceneComponentRegistry } from "../../../src/components/register-scene-components.js";

const settings = {
    movementSpeed: 4,
    runMultiplier: 2,
    lookSensitivity: 0.002,
    maxPitchRadians: 1.5533430342749532,
};

test("requires settings and rejects invalid camera-controller values", () => {
    assert.throws(
        () => new CameraController(),
        /requires settings from scene data/,
    );

    assert.throws(
        () =>
            new CameraController({
                ...settings,
                movementSpeed: -1,
            }),
        /settings are invalid/,
    );

    assert.throws(
        () =>
            new CameraController({
                ...settings,
                maxPitchRadians: Math.PI / 2,
            }),
        /settings are invalid/,
    );
});

test("serializes camera-controller settings as component version 1", () => {
    const registry = CreateSceneComponentRegistry();
    const { componentType, component } = registry.CreateComponent(
        "cameraController",
        settings,
    );

    assert.equal(componentType, CameraController);
    assert.deepEqual(
        registry.SerializeComponent(component),
        {
            typeId: "cameraController",
            version: 1,
            data: settings,
        },
    );
});
