export class Mesh {
    constructor(positions) {
        if (!(positions instanceof Float32Array)) {
            throw new TypeError("Mesh positions must be a Float32Array.");
        }

        if (positions.length === 0 || positions.length % 9 !== 0) {
            throw new RangeError(
                "Mesh positions must contain complete xyz triangles.",
            );
        }

        this._positions = positions.slice();
    }

    get VertexCount() {
        return this._positions.length / 3;
    }

    GetPositions() {
        return this._positions.slice();
    }
}
