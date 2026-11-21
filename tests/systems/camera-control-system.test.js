import assert from "node:assert/strict";
import test from "node:test";
import { Camera } from "../../src/components/graphics/camera.js";
import { CameraController } from "../../src/components/graphics/camera-controller.js";
import { Parent } from "../../src/components/parent.js";
import { Transform } from "../../src/components/transform.js";
import { InputManager } from "../../src/core/input/input-manager.js";
import { Scene } from "../../src/core/scene/scene.js";
import { SystemPhase } from "../../src/core/scene/system-scheduler.js";
import { MultiplyMatrix4 } from "../../src/math/matrix4.js";
import { CameraControlSystem } from "../../src/systems/camera-control-system.js";

const controllerSettings = {
    movementSpeed: 4,
    runMultiplier: 2,
    lookSensitivity: 0.002,
    maxPitchRadians: 1.5533430342749532,
};

const actionMap = {
    version: 1,
    actions: {
        moveForward: {
            bindings: [{ device: "keyboard", code: "KeyW" }],
        },
        moveBackward: {
            bindings: [{ device: "keyboard", code: "KeyS" }],
        },
        moveLeft: {
            bindings: [{ device: "keyboard", code: "KeyA" }],
        },
        moveRight: {
            bindings: [{ device: "keyboard", code: "KeyD" }],
        },
        run: {
            bindings: [{ device: "keyboard", code: "ShiftLeft" }],
        },
    },
};

function CreateCameraScene({
    keysDown = [],
    pointerDeltaX = 0,
    pointerDeltaY = 0,
    isPointerLocked = false,
    settings = controllerSettings,
    parentRotation = null,
} = {}) {
    const frameInput = {
        keysDown: new Set(keysDown),
        keysPressed: new Set(),
        keysReleased: new Set(),
        pointerDeltaX,
        pointerDeltaY,
        isPointerLocked,
    };
    const input = new InputManager(
        { ConsumeFrameInput: () => frameInput },
        actionMap,
    );
    input.Update();

    const scene = new Scene("camera-control-test");
    const cameraEntityId = scene.EntityManager.CreateEntity();
    const transform = new Transform();
    let parentTransform = null;

    if (parentRotation !== null) {
        const parentEntityId = scene.EntityManager.CreateEntity();
        parentTransform = new Transform();
        parentTransform.rotation = [...parentRotation];
        scene.EntityManager.AddComponent(
            parentEntityId,
            Transform,
            parentTransform,
        );
        scene.EntityManager.AddComponent(
            cameraEntityId,
            Parent,
            new Parent(parentEntityId),
        );
    }

    scene.EntityManager.AddComponent(cameraEntityId, Transform, transform);
    scene.EntityManager.AddComponent(cameraEntityId, Camera, new Camera());
    scene.EntityManager.AddComponent(
        cameraEntityId,
        CameraController,
        new CameraController(settings),
    );
    scene.SetActiveCameraEntity(cameraEntityId);
    scene.AddSystem(
        SystemPhase.FixedUpdate,
        new CameraControlSystem(),
    );
    scene.Initialize({ input });

    return { scene, transform, parentTransform };
}

test("moves forward using fixed delta time", () => {
    const { scene, transform } = CreateCameraScene({
        keysDown: ["KeyW"],
    });

    try {
        scene.FixedUpdate(0.5, 0.5);

        assert.deepEqual(transform.position, [0, 0, -2]);
    } finally {
        scene.Dispose();
    }
});

test("keeps camera movement horizontal under a tilted parent", () => {
    const { scene, transform, parentTransform } = CreateCameraScene({
        keysDown: ["KeyW"],
        parentRotation: [Math.PI / 4, 0, 0],
    });

    try {
        scene.FixedUpdate(0.5, 0.5);

        const cameraWorldMatrix = MultiplyMatrix4(
            new Float32Array(16),
            parentTransform.GetModelMatrix(),
            transform.GetModelMatrix(),
        );

        assert.ok(Math.abs(cameraWorldMatrix[12]) < 1e-6);
        assert.ok(Math.abs(cameraWorldMatrix[13]) < 1e-6);
        assert.ok(Math.abs(cameraWorldMatrix[14] + 2) < 1e-6);
    } finally {
        scene.Dispose();
    }
});

test("normalizes diagonal movement and applies the run multiplier", () => {
    const { scene, transform } = CreateCameraScene({
        keysDown: ["KeyW", "KeyD", "ShiftLeft"],
    });

    try {
        scene.FixedUpdate(1, 1);

        const expectedOffset = 8 / Math.sqrt(2);

        assert.ok(Math.abs(transform.position[0] - expectedOffset) < 1e-10);
        assert.ok(Math.abs(transform.position[2] + expectedOffset) < 1e-10);
    } finally {
        scene.Dispose();
    }
});

test("applies pointer look only while pointer lock is active", () => {
    const lockedScene = CreateCameraScene({
        pointerDeltaX: 10,
        pointerDeltaY: -5,
        isPointerLocked: true,
    });

    try {
        lockedScene.scene.FixedUpdate(1 / 60, 1 / 60);

        assert.ok(
            Math.abs(lockedScene.transform.rotation[0] - 0.01) < 1e-10,
        );
        assert.ok(
            Math.abs(lockedScene.transform.rotation[1] + 0.02) < 1e-10,
        );
    } finally {
        lockedScene.scene.Dispose();
    }

    const unlockedScene = CreateCameraScene({
        pointerDeltaX: 10,
        pointerDeltaY: -5,
        isPointerLocked: false,
    });

    try {
        unlockedScene.scene.FixedUpdate(1 / 60, 1 / 60);

        assert.deepEqual(unlockedScene.transform.rotation, [0, 0, 0]);
    } finally {
        unlockedScene.scene.Dispose();
    }
});

test("clamps camera pitch to the configured limit", () => {
    const { scene, transform } = CreateCameraScene({
        pointerDeltaY: -20,
        isPointerLocked: true,
        settings: {
            ...controllerSettings,
            lookSensitivity: 0.1,
            maxPitchRadians: 0.5,
        },
    });

    transform.rotation[0] = 0.49;

    try {
        scene.FixedUpdate(1 / 60, 1 / 60);

        assert.equal(transform.rotation[0], 0.5);
    } finally {
        scene.Dispose();
    }
});
