import { Mesh } from "../mesh.js";

export function CreateCubeMesh(size = 1) {
    if (!Number.isFinite(size) || size <= 0) {
        throw new RangeError("Cube size must be a positive number.");
    }

    const halfSize = size / 2;
    const corners = [
        [-halfSize, -halfSize, -halfSize],
        [halfSize, -halfSize, -halfSize],
        [halfSize, halfSize, -halfSize],
        [-halfSize, halfSize, -halfSize],
        [-halfSize, -halfSize, halfSize],
        [halfSize, -halfSize, halfSize],
        [halfSize, halfSize, halfSize],
        [-halfSize, halfSize, halfSize],
    ];

    const faces = [
        [4, 5, 6, 4, 6, 7],
        [1, 0, 3, 1, 3, 2],
        [7, 6, 2, 7, 2, 3],
        [0, 1, 5, 0, 5, 4],
        [5, 1, 2, 5, 2, 6],
        [0, 4, 7, 0, 7, 3],
    ];

    const positions = new Float32Array(faces.length * 6 * 3);
    let offset = 0;

    for (const face of faces) {
        for (const cornerIndex of face) {
            const corner = corners[cornerIndex];

            positions[offset++] = corner[0];
            positions[offset++] = corner[1];
            positions[offset++] = corner[2];
        }
    }

    return new Mesh(positions);
}
