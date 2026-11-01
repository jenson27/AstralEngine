import {
    AddHorizontalCap,
    AddRadialSurface,
    CreatePrimitiveMesh,
    RequirePositiveNumber,
    RequireSegmentCount,
} from "./primitive-utils.js";

export function CreateCylinderMesh(
    radius = 0.5,
    height = 1,
    radialSegments = 24,
) {
    RequirePositiveNumber(radius, "Cylinder radius");
    RequirePositiveNumber(height, "Cylinder height");
    RequireSegmentCount(radialSegments, "Cylinder radial segments");

    const halfHeight = height / 2;
    const positions = [];
    const uvs = [];
    const profile = [
        { y: halfHeight, radius, v: 0 },
        { y: -halfHeight, radius, v: 1 },
    ];

    AddRadialSurface(positions, uvs, profile, radialSegments);
    AddHorizontalCap(
        positions,
        uvs,
        halfHeight,
        radius,
        radialSegments,
        true,
    );
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
