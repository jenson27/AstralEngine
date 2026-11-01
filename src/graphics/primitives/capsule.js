import {
    AddRadialSurface,
    CreatePrimitiveMesh,
    RequirePositiveNumber,
    RequireSegmentCount,
} from "./primitive-utils.js";

export function CreateCapsuleMesh(
    radius = 0.25,
    height = 1,
    radialSegments = 24,
    hemisphereRings = 8,
) {
    RequirePositiveNumber(radius, "Capsule radius");
    RequirePositiveNumber(height, "Capsule height");
    RequireSegmentCount(radialSegments, "Capsule radial segments");
    RequireSegmentCount(hemisphereRings, "Capsule hemisphere rings", 1);

    if (height < radius * 2) {
        throw new RangeError(
            "Capsule height must be at least twice its radius.",
        );
    }

    const straightLength = height - radius * 2;
    const halfStraightLength = straightLength / 2;
    const profile = [];

    for (let ring = 0; ring <= hemisphereRings; ring += 1) {
        const angle = (ring / hemisphereRings) * (Math.PI / 2);
        const y = halfStraightLength + radius * Math.cos(angle);

        profile.push({
            y,
            radius:
                ring === 0 ? 0 : radius * Math.sin(angle),
            v: (height / 2 - y) / height,
        });
    }

    if (straightLength > 0) {
        profile.push({
            y: -halfStraightLength,
            radius,
            v: (height / 2 + halfStraightLength) / height,
        });
    }

    for (let ring = 1; ring <= hemisphereRings; ring += 1) {
        const angle = Math.PI / 2 + (ring / hemisphereRings) * (Math.PI / 2);
        const y = -halfStraightLength + radius * Math.cos(angle);

        profile.push({
            y,
            radius:
                ring === hemisphereRings ? 0 : radius * Math.sin(angle),
            v: (height / 2 - y) / height,
        });
    }

    const positions = [];
    const uvs = [];
    AddRadialSurface(positions, uvs, profile, radialSegments);

    return CreatePrimitiveMesh(positions, uvs);
}
