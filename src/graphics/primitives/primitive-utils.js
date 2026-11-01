import { Mesh } from "../mesh.js";

export function RequirePositiveNumber(value, label) {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${label} must be a positive finite number.`);
    }
}

export function RequireSegmentCount(value, label, minimum = 3) {
    if (!Number.isSafeInteger(value) || value < minimum) {
        throw new RangeError(
            `${label} must be an integer of at least ${minimum}.`,
        );
    }
}

export function PushTriangle(positions, uvs, first, second, third) {
    for (const vertex of [first, second, third]) {
        positions.push(...vertex.position);
        uvs.push(vertex.uv[0], 1 - vertex.uv[1]);
    }
}

export function CreatePrimitiveMesh(positions, uvs) {
    return new Mesh(
        new Float32Array(positions),
        new Float32Array(uvs),
    );
}

export function AddRadialSurface(positions, uvs, profile, radialSegments) {
    for (let profileIndex = 0; profileIndex < profile.length - 1; profileIndex += 1) {
        const upperRing = profile[profileIndex];
        const lowerRing = profile[profileIndex + 1];

        for (let segment = 0; segment < radialSegments; segment += 1) {
            const firstU = segment / radialSegments;
            const secondU = (segment + 1) / radialSegments;
            const firstAngle = firstU * Math.PI * 2;
            const secondAngle = secondU * Math.PI * 2;
            const upperFirst = CreateRadialVertex(upperRing, firstAngle, firstU);
            const upperSecond = CreateRadialVertex(
                upperRing,
                secondAngle,
                secondU,
            );
            const lowerFirst = CreateRadialVertex(lowerRing, firstAngle, firstU);
            const lowerSecond = CreateRadialVertex(
                lowerRing,
                secondAngle,
                secondU,
            );

            if (upperRing.radius === 0) {
                PushTriangle(
                    positions,
                    uvs,
                    upperSecond,
                    lowerSecond,
                    lowerFirst,
                );
                continue;
            }

            if (lowerRing.radius === 0) {
                PushTriangle(
                    positions,
                    uvs,
                    upperFirst,
                    upperSecond,
                    lowerFirst,
                );
                continue;
            }

            PushTriangle(
                positions,
                uvs,
                upperFirst,
                upperSecond,
                lowerFirst,
            );
            PushTriangle(
                positions,
                uvs,
                upperSecond,
                lowerSecond,
                lowerFirst,
            );
        }
    }
}

export function AddHorizontalCap(
    positions,
    uvs,
    y,
    radius,
    radialSegments,
    isTop,
) {
    const center = {
        position: [0, y, 0],
        uv: [0.5, 0.5],
    };

    for (let segment = 0; segment < radialSegments; segment += 1) {
        const firstAngle = (segment / radialSegments) * Math.PI * 2;
        const secondAngle = ((segment + 1) / radialSegments) * Math.PI * 2;
        const first = CreateCapVertex(y, radius, firstAngle);
        const second = CreateCapVertex(y, radius, secondAngle);

        if (isTop) {
            PushTriangle(positions, uvs, center, second, first);
        } else {
            PushTriangle(positions, uvs, center, first, second);
        }
    }
}

function CreateRadialVertex(ring, angle, u) {
    return {
        position: [
            ring.radius * Math.cos(angle),
            ring.y,
            ring.radius * Math.sin(angle),
        ],
        uv: [u, ring.v],
    };
}

function CreateCapVertex(y, radius, angle) {
    const x = Math.cos(angle);
    const z = Math.sin(angle);

    return {
        position: [radius * x, y, radius * z],
        uv: [0.5 + x * 0.5, 0.5 + z * 0.5],
    };
}
