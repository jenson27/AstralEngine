import { Mesh } from "../mesh.js";

export function CreateTriangleMesh() {
    return new Mesh(
        new Float32Array([
            0.0, 0.6, 0.0,
            -0.6, -0.5, 0.0,
            0.6, -0.5, 0.0,
        ]),
    );
}
