import { CreateCubeMesh } from "../primitives/cube.js";
import { CreateTriangleMesh } from "../primitives/triangle.js";
import { CreateCapsuleMesh } from "../primitives/capsule.js";
import { CreateConeMesh } from "../primitives/cone.js";
import { CreateCylinderMesh } from "../primitives/cylinder.js";
import { CreatePlaneMesh } from "../primitives/plane.js";
import { CreateSphereMesh } from "../primitives/sphere.js";

export class BuiltinMeshLoader {
    Load(descriptor) {
        if (descriptor.source.kind !== "primitive") {
            throw new Error(
                "Built-in mesh loader only supports primitive sources.",
            );
        }

        if (descriptor.source.name === "cube") {
            return CreateCubeMesh(descriptor.source.size);
        }

        if (descriptor.source.name === "triangle") {
            return CreateTriangleMesh();
        }

        if (descriptor.source.name === "capsule") {
            return CreateCapsuleMesh(
                descriptor.source.radius,
                descriptor.source.height,
                descriptor.source.radialSegments,
                descriptor.source.hemisphereRings,
            );
        }

        if (descriptor.source.name === "cone") {
            return CreateConeMesh(
                descriptor.source.radius,
                descriptor.source.height,
                descriptor.source.radialSegments,
            );
        }

        if (descriptor.source.name === "cylinder") {
            return CreateCylinderMesh(
                descriptor.source.radius,
                descriptor.source.height,
                descriptor.source.radialSegments,
            );
        }

        if (descriptor.source.name === "plane") {
            return CreatePlaneMesh(descriptor.source.size);
        }

        if (descriptor.source.name === "sphere") {
            return CreateSphereMesh(
                descriptor.source.radius,
                descriptor.source.latitudeBands,
                descriptor.source.longitudeSegments,
            );
        }

        throw new Error(
            "Unknown built-in mesh: " + descriptor.source.name,
        );
    }
}
