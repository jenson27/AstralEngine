import {
    SetOrthographicMatrix,
    SetPerspectiveMatrix,
    SetViewMatrixFromTransform,
    SetViewMatrixFromWorldMatrix,
} from "../../math/matrix4.js";

export function ValidateCameraSettings(camera) {
    if (
        !["perspective", "orthographic"].includes(camera.projectionType) ||
        !Number.isFinite(camera.nearPlane) ||
        camera.nearPlane <= 0 ||
        !Number.isFinite(camera.farPlane) ||
        camera.farPlane <= camera.nearPlane ||
        !Number.isFinite(camera.fieldOfView) ||
        camera.fieldOfView <= 0 ||
        camera.fieldOfView >= Math.PI ||
        !Number.isFinite(camera.orthographicSize) ||
        camera.orthographicSize <= 0
    ) {
        throw new RangeError("Camera settings are invalid.");
    }
}

export class Camera {
    constructor() {
        this.projectionType = "perspective";
        this.fieldOfView = Math.PI / 3;
        this.orthographicSize = 5;
        this.nearPlane = 0.1;
        this.farPlane = 100;

        this._viewMatrix = new Float32Array(16);
        this._projectionMatrix = new Float32Array(16);
        this._projectionParameters = null;
    }

    SetSettings(settings) {
        const nextSettings = {
            projectionType: settings?.projectionType,
            fieldOfView: settings?.fieldOfView,
            orthographicSize: settings?.orthographicSize,
            nearPlane: settings?.nearPlane,
            farPlane: settings?.farPlane,
        };
        ValidateCameraSettings(nextSettings);

        this.projectionType = nextSettings.projectionType;
        this.fieldOfView = nextSettings.fieldOfView;
        this.orthographicSize = nextSettings.orthographicSize;
        this.nearPlane = nextSettings.nearPlane;
        this.farPlane = nextSettings.farPlane;
    }

    UpdateMatrices(transform, aspectRatio) {
        SetViewMatrixFromTransform(
            this._viewMatrix,
            transform.position,
            transform.rotation,
        );

        return this._UpdateProjectionMatrix(aspectRatio);
    }

    UpdateMatricesFromWorldMatrix(worldMatrix, aspectRatio) {
        SetViewMatrixFromWorldMatrix(this._viewMatrix, worldMatrix);

        return this._UpdateProjectionMatrix(aspectRatio);
    }

    _UpdateProjectionMatrix(aspectRatio) {
        ValidateCameraSettings(this);
        const projectionChanged =
            this._projectionParameters === null ||
            this._projectionParameters.projectionType !== this.projectionType ||
            this._projectionParameters.fieldOfView !== this.fieldOfView ||
            this._projectionParameters.orthographicSize !==
                this.orthographicSize ||
            this._projectionParameters.aspectRatio !== aspectRatio ||
            this._projectionParameters.nearPlane !== this.nearPlane ||
            this._projectionParameters.farPlane !== this.farPlane;

        if (projectionChanged) {
            if (this.projectionType === "perspective") {
                SetPerspectiveMatrix(
                    this._projectionMatrix,
                    this.fieldOfView,
                    aspectRatio,
                    this.nearPlane,
                    this.farPlane,
                );
            } else {
                SetOrthographicMatrix(
                    this._projectionMatrix,
                    this.orthographicSize,
                    aspectRatio,
                    this.nearPlane,
                    this.farPlane,
                );
            }

            this._projectionParameters = {
                projectionType: this.projectionType,
                fieldOfView: this.fieldOfView,
                orthographicSize: this.orthographicSize,
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
