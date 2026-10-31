import { Mesh } from "../../graphics/mesh.js";

export class MeshRenderer {
    constructor(mesh) {
        if (!(mesh instanceof Mesh)) {
            throw new TypeError("MeshRenderer requires a Mesh.");
        }

        this.mesh = mesh;
    }
}
