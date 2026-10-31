import {
    SetPerspectiveMatrix,
    SetViewMatrixFromTransform,
} from "../../math/matrix4.js";

export class Camera {
    constructor() {
        this.fieldOfView = Math.PI / 3;
        this.nearPlane = 0.1;
        this.farPlane = 100;

        this._viewMatrix = new Float32Array(16);
        this._projectionMatrix = new Float32Array(16);
        this._projectionParameters = null;
    }

    UpdateMatrices(transform, aspectRatio) {
        SetViewMatrixFromTransform(
            this._viewMatrix,
            transform.position,
            transform.rotation,
        );

        const projectionChanged =
            this._projectionParameters === null ||
            this._projectionParameters.fieldOfView !== this.fieldOfView ||
            this._projectionParameters.aspectRatio !== aspectRatio ||
            this._projectionParameters.nearPlane !== this.nearPlane ||
            this._projectionParameters.farPlane !== this.farPlane;

        if (projectionChanged) {
            SetPerspectiveMatrix(
                this._projectionMatrix,
                this.fieldOfView,
                aspectRatio,
                this.nearPlane,
                this.farPlane,
            );

            this._projectionParameters = {
                fieldOfView: this.fieldOfView,
                aspectRatio,
                nearPlane: this.nearPlane,
                farPlane: this.farPlane,
            };
        }

        return {
            viewMatrix: this._viewMatrix,
            projectionMatrix: this._projectionMatrix,
        };
    }
}
