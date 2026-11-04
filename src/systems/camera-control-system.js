import { Transform } from "../components/transform.js";
import { Parent } from "../components/parent.js";
import { CameraController } from "../components/graphics/camera-controller.js";
import {
    MultiplyMatrix4,
    SetViewMatrixFromWorldMatrix,
} from "../math/matrix4.js";

const requiredActionNames = [
    "moveForward",
    "moveBackward",
    "moveLeft",
    "moveRight",
    "run",
];

const directionEpsilon = 1e-8;

export class CameraControlSystem {
    constructor() {
        this._input = null;
        this._entityChain = [];
        this._cameraWorldMatrix = new Float32Array(16);
        this._parentWorldMatrix = new Float32Array(16);
        this._inverseParentWorldMatrix = new Float32Array(16);
        this._matrixScratch = new Float32Array(16);
        this._forwardDirection = { x: 0, z: 0 };
    }

    Initialize(_scene, services) {
        const input = services?.input;

        if (
            !input ||
            typeof input.IsActionDown !== "function" ||
            typeof input.GetPointerDelta !== "function" ||
            typeof input.IsPointerLocked !== "function"
        ) {
            throw new TypeError(
                "CameraControlSystem requires the input service.",
            );
        }

        for (const actionName of requiredActionNames) {
            input.IsActionDown(actionName);
        }

        this._input = input;
    }

    Shutdown() {
        this._input = null;
    }

    FixedUpdate(scene, { deltaTime }) {
        if (this._input === null) {
            throw new Error("CameraControlSystem is not initialized.");
        }

        const cameraEntityId = scene.ActiveCameraEntityId;

        if (cameraEntityId === null) {
            return;
        }

        const entityManager = scene.EntityManager;
        const cameraController = entityManager.GetComponent(
            cameraEntityId,
            CameraController,
        );

        if (!cameraController) {
            return;
        }

        const transform = entityManager.GetComponent(
            cameraEntityId,
            Transform,
        );

        if (!transform) {
            throw new Error(
                "The active camera controller needs a Transform component.",
            );
        }

        if (this._input.IsPointerLocked()) {
            this._ApplyPointerLook(
                transform,
                cameraController,
                this._input.GetPointerDelta(),
            );
        }

        let forwardInput =
            (this._input.IsActionDown("moveForward") ? 1 : 0) -
            (this._input.IsActionDown("moveBackward") ? 1 : 0);
        let rightInput =
            (this._input.IsActionDown("moveRight") ? 1 : 0) -
            (this._input.IsActionDown("moveLeft") ? 1 : 0);

        const inputLength = Math.hypot(forwardInput, rightInput);

        if (inputLength > 1) {
            forwardInput /= inputLength;
            rightInput /= inputLength;
        }

        if (inputLength === 0) {
            return;
        }

        const runMultiplier = this._input.IsActionDown("run")
            ? cameraController.runMultiplier
            : 1;
        const distance =
            cameraController.movementSpeed *
            runMultiplier *
            deltaTime;

        this._MoveInWorldPlane(
            scene,
            cameraEntityId,
            transform,
            forwardInput,
            rightInput,
            distance,
        );
    }

    _MoveInWorldPlane(
        scene,
        cameraEntityId,
        transform,
        forwardInput,
        rightInput,
        distance,
    ) {
        const cameraWorldMatrix = this._BuildWorldMatrix(
            scene,
            cameraEntityId,
            this._cameraWorldMatrix,
        );

        if (!this._GetHorizontalForwardDirection(cameraWorldMatrix)) {
            return;
        }

        const forwardX = this._forwardDirection.x;
        const forwardZ = this._forwardDirection.z;
        const rightX = -forwardZ;
        const rightZ = forwardX;
        const worldDeltaX =
            (forwardX * forwardInput + rightX * rightInput) * distance;
        const worldDeltaZ =
            (forwardZ * forwardInput + rightZ * rightInput) * distance;

        this._ApplyWorldMovement(
            scene,
            cameraEntityId,
            transform,
            worldDeltaX,
            worldDeltaZ,
        );
    }

    _GetHorizontalForwardDirection(cameraWorldMatrix) {
        const direction = this._forwardDirection;
        direction.x = -cameraWorldMatrix[8];
        direction.z = -cameraWorldMatrix[10];

        let length = Math.hypot(direction.x, direction.z);

        if (length < directionEpsilon) {
            direction.x = cameraWorldMatrix[2];
            direction.z = -cameraWorldMatrix[0];
            length = Math.hypot(direction.x, direction.z);
        }

        if (length < directionEpsilon) {
            return false;
        }

        direction.x /= length;
        direction.z /= length;
        return true;
    }

    _ApplyWorldMovement(
        scene,
        cameraEntityId,
        transform,
        worldDeltaX,
        worldDeltaZ,
    ) {
        const parent = scene.EntityManager.GetComponent(
            cameraEntityId,
            Parent,
        );

        if (!parent) {
            transform.position[0] += worldDeltaX;
            transform.position[2] += worldDeltaZ;
            return;
        }

        const parentWorldMatrix = this._BuildWorldMatrix(
            scene,
            parent.ParentEntityId,
            this._parentWorldMatrix,
        );

        SetViewMatrixFromWorldMatrix(
            this._inverseParentWorldMatrix,
            parentWorldMatrix,
        );

        const inverseParent = this._inverseParentWorldMatrix;
        transform.position[0] +=
            inverseParent[0] * worldDeltaX +
            inverseParent[8] * worldDeltaZ;
        transform.position[1] +=
            inverseParent[1] * worldDeltaX +
            inverseParent[9] * worldDeltaZ;
        transform.position[2] +=
            inverseParent[2] * worldDeltaX +
            inverseParent[10] * worldDeltaZ;
    }

    _BuildWorldMatrix(scene, entityId, outputMatrix) {
        const entityManager = scene.EntityManager;
        const chain = this._entityChain;
        chain.length = 0;

        let currentEntityId = entityId;

        while (currentEntityId !== null) {
            chain.push(currentEntityId);

            const parent = entityManager.GetComponent(
                currentEntityId,
                Parent,
            );
            currentEntityId = parent?.ParentEntityId ?? null;
        }

        let hasWorldTransform = false;

        for (let index = chain.length - 1; index >= 0; index -= 1) {
            const transform = entityManager.GetComponent(
                chain[index],
                Transform,
            );

            if (!transform) {
                throw new Error(
                    "Camera hierarchy entities must have Transform components.",
                );
            }

            const localMatrix = transform.GetModelMatrix();

            if (!hasWorldTransform) {
                outputMatrix.set(localMatrix);
                hasWorldTransform = true;
                continue;
            }

            MultiplyMatrix4(
                this._matrixScratch,
                outputMatrix,
                localMatrix,
            );
            outputMatrix.set(this._matrixScratch);
        }

        return outputMatrix;
    }

    _ApplyPointerLook(transform, cameraController, pointerDelta) {
        transform.rotation[0] = Math.max(
            -cameraController.maxPitchRadians,
            Math.min(
                cameraController.maxPitchRadians,
                transform.rotation[0] -
                    pointerDelta.y * cameraController.lookSensitivity,
            ),
        );

        const yaw =
            transform.rotation[1] -
            pointerDelta.x * cameraController.lookSensitivity;

        transform.rotation[1] = Math.atan2(
            Math.sin(yaw),
            Math.cos(yaw),
        );
    }
}
