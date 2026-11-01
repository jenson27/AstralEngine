import { CreatePrimitiveMesh, PushTriangle, RequirePositiveNumber } from "./primitive-utils.js";

export function CreatePlaneMesh(size = 1) {
    RequirePositiveNumber(size, "Plane size");

    const halfSize = size / 2;
    const positions = [];
    const uvs = [];
    const firstCorner = {
        position: [-halfSize, 0, -halfSize],
        uv: [0, 0],
    };
    const secondCorner = {
        position: [-halfSize, 0, halfSize],
        uv: [0, 1],
    };
    const thirdCorner = {
        position: [halfSize, 0, halfSize],
        uv: [1, 1],
    };
    const fourthCorner = {
        position: [halfSize, 0, -halfSize],
        uv: [1, 0],
    };

    PushTriangle(positions, uvs, firstCorner, secondCorner, thirdCorner);
    PushTriangle(positions, uvs, firstCorner, thirdCorner, fourthCorner);

    return CreatePrimitiveMesh(positions, uvs);
}
