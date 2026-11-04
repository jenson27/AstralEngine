import {
    MultiplyMatrix4,
    SetQuaternionFromEuler,
    SetTRSMatrix,
    SetTRSMatrixFromQuaternion,
    SlerpQuaternion,
} from "../math/matrix4.js";

export class Transform {
    constructor() {
        this.position = [0, 0, 0];
        this.rotation = [0, 0, 0];
        this.scale = [1, 1, 1];
        this._modelMatrix = new Float32Array(16);
        this._worldMatrix = new Float32Array(16);
        this._previousPosition = [0, 0, 0];
        this._previousRotationQuaternion = [0, 0, 0, 1];
        this._currentRotationQuaternion = [0, 0, 0, 1];
        this._previousScale = [1, 1, 1];
        this._interpolatedState = {
            position: [0, 0, 0],
            rotationQuaternion: [0, 0, 0, 1],
            scale: [1, 1, 1],
        };
        this._hasPreviousState = false;
    }

    CapturePreviousState() {
        for (let axis = 0; axis < 3; axis += 1) {
            this._previousPosition[axis] = this.position[axis];
            this._previousScale[axis] = this.scale[axis];
        }

        SetQuaternionFromEuler(
            this._previousRotationQuaternion,
            this.rotation,
        );
        this._hasPreviousState = true;
    }

    SnapInterpolationToCurrentState() {
        this.CapturePreviousState();
    }

    GetInterpolatedState(alpha) {
        if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
            throw new RangeError(
                "Transform interpolation alpha must be between 0 and 1.",
            );
        }

        if (!this._hasPreviousState) {
            this.CapturePreviousState();
        }

        for (let axis = 0; axis < 3; axis += 1) {
            this._interpolatedState.position[axis] =
                this._previousPosition[axis] +
                (this.position[axis] - this._previousPosition[axis]) * alpha;
            this._interpolatedState.scale[axis] =
                this._previousScale[axis] +
                (this.scale[axis] - this._previousScale[axis]) * alpha;
        }

        SetQuaternionFromEuler(
            this._currentRotationQuaternion,
            this.rotation,
        );
        SlerpQuaternion(
            this._interpolatedState.rotationQuaternion,
            this._previousRotationQuaternion,
            this._currentRotationQuaternion,
            alpha,
        );

        return this._interpolatedState;
    }

    GetInterpolatedModelMatrix(alpha) {
        const state = this.GetInterpolatedState(alpha);

        return SetTRSMatrixFromQuaternion(
            this._modelMatrix,
            state.position,
            state.rotationQuaternion,
            state.scale,
        );
    }

    get WorldMatrix() {
        return this._worldMatrix;
    }

    UpdateWorldMatrix(parentWorldMatrix, alpha) {
        const localMatrix = this.GetInterpolatedModelMatrix(alpha);

        if (parentWorldMatrix === null) {
            this._worldMatrix.set(localMatrix);
            return this._worldMatrix;
        }

        return MultiplyMatrix4(
            this._worldMatrix,
            parentWorldMatrix,
            localMatrix,
        );
    }

    GetModelMatrix() {
        return SetTRSMatrix(
            this._modelMatrix,
            this.position,
            this.rotation,
            this.scale,
        );
    }
}
