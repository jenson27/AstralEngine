import { Material } from "../material.js";

export class MaterialLoader {
    Load(descriptor, { GetDependency }) {
        if (descriptor.source?.kind !== "material") {
            throw new Error(
                "Material loader only supports material sources.",
            );
        }

        const textureAssetId =
            descriptor.source.baseColorTextureAssetId;

        if (
            typeof textureAssetId !== "string" ||
            textureAssetId.trim() === ""
        ) {
            throw new TypeError(
                "Material must define a base color texture asset ID.",
            );
        }

        return new Material(GetDependency(textureAssetId));
    }
}
