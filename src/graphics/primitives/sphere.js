import {
    AddRadialSurface,
    CreatePrimitiveMesh,
    RequirePositiveNumber,
    RequireSegmentCount,
} from "./primitive-utils.js";

export function CreateSphereMesh(
    radius = 0.5,
    latitudeBands = 16,
    longitudeSegments = 24,
) {
    RequirePositiveNumber(radius, "Sphere radius");
    RequireSegmentCount(latitudeBands, "Sphere latitude bands", 2);
    RequireSegmentCount(longitudeSegments, "Sphere longitude segments");

    const profile = [];
    for (let band = 0; band <= latitudeBands; band += 1) {
        const latitude = (band / latitudeBands) * Math.PI;
        profile.push({
            y: radius * Math.cos(latitude),
            radius:
                band === 0 || band === latitudeBands
                    ? 0
                    : radius * Math.sin(latitude),
            v: band / latitudeBands,
        });
    }

    const positions = [];
    const uvs = [];
    AddRadialSurface(positions, uvs, profile, longitudeSegments);

    return CreatePrimitiveMesh(positions, uvs);
}
