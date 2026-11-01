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

    const faceGroups = [
        {
            materialSlot: "side",
            faces: [
                [4, 5, 6, 4, 6, 7],
                [1, 0, 3, 1, 3, 2],
                [5, 1, 2, 5, 2, 6],
                [0, 4, 7, 0, 7, 3],
            ],
        },
        {
            materialSlot: "top",
            faces: [[7, 6, 2, 7, 2, 3]],
        },
        {
            materialSlot: "bottom",
            faces: [[0, 1, 5, 0, 5, 4]],
        },
    ];

    const faceUvs = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
        [1, 1],
        [0, 1],
    ];
    const vertexCount = faceGroups.reduce(
        (count, group) => count + group.faces.length * 6,
        0,
    );
    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const submeshes = [];
    let positionOffset = 0;
    let uvOffset = 0;

    for (const group of faceGroups) {
        const firstVertex = positionOffset / 3;

        for (const face of group.faces) {
            for (
                let vertexIndex = 0;
                vertexIndex < face.length;
                vertexIndex += 1
            ) {
                const corner = corners[face[vertexIndex]];
                const uv = faceUvs[vertexIndex];

                positions[positionOffset++] = corner[0];
                positions[positionOffset++] = corner[1];
                positions[positionOffset++] = corner[2];

                uvs[uvOffset++] = uv[0];
                uvs[uvOffset++] = 1 - uv[1];
            }
        }

        submeshes.push({
            materialSlot: group.materialSlot,
            firstVertex,
            vertexCount: group.faces.length * 6,
        });
    }

    return new Mesh(positions, uvs, submeshes);
}
