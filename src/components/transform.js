import { SetTRSMatrix } from "../math/matrix4.js";

export class Transform {
    constructor() {
        this.position = [0, 0, 0];
        this.rotation = [0, 0, 0];
        this.scale = [1, 1, 1];
        this._modelMatrix = new Float32Array(16);
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
