import { CreateCubeMesh } from "../primitives/cube.js";
import { CreateTriangleMesh } from "../primitives/triangle.js";

export class BuiltinMeshLoader {
    Load(descriptor) {
        if (descriptor.source.kind !== "primitive") {
            throw new Error(
                "Built-in mesh loader only supports primitive sources.",
            );
        }

        if (descriptor.source.name === "cube") {
            return CreateCubeMesh();
        }

        if (descriptor.source.name === "triangle") {
            return CreateTriangleMesh();
        }

        throw new Error(
            "Unknown built-in mesh: " + descriptor.source.name,
        );
    }
}
