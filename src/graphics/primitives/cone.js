import {
    AddHorizontalCap,
    AddRadialSurface,
    CreatePrimitiveMesh,
    RequirePositiveNumber,
    RequireSegmentCount,
} from "./primitive-utils.js";

export function CreateConeMesh(
    radius = 0.5,
    height = 1,
    radialSegments = 24,
) {
    RequirePositiveNumber(radius, "Cone radius");
    RequirePositiveNumber(height, "Cone height");
    RequireSegmentCount(radialSegments, "Cone radial segments");

    const halfHeight = height / 2;
    const positions = [];
    const uvs = [];
    const profile = [
        { y: halfHeight, radius: 0, v: 0 },
        { y: -halfHeight, radius, v: 1 },
    ];

    AddRadialSurface(positions, uvs, profile, radialSegments);
    AddHorizontalCap(
        positions,
        uvs,
        -halfHeight,
        radius,
        radialSegments,
        false,
    );

    return CreatePrimitiveMesh(positions, uvs);
}
