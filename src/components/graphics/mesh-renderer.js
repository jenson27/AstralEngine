import { Mesh } from "../../graphics/mesh.js";
import { Material } from "../../graphics/material.js";

export class MeshRenderer {
    constructor(mesh, materialsBySlot) {
        if (!(mesh instanceof Mesh)) {
            throw new TypeError("MeshRenderer requires a Mesh.");
        }

        if (materialsBySlot instanceof Material) {
            materialsBySlot = Object.fromEntries(
                mesh.Submeshes.map(({ materialSlot }) => [
                    materialSlot,
                    materialsBySlot,
                ]),
            );
        }

        if (
            !materialsBySlot ||
            typeof materialsBySlot !== "object" ||
            Array.isArray(materialsBySlot)
        ) {
            throw new TypeError(
                "MeshRenderer requires materials keyed by mesh slot.",
            );
        }

        const normalizedMaterials = Object.create(null);
        const validSlots = new Set();

        for (const { materialSlot } of mesh.Submeshes) {
            validSlots.add(materialSlot);
            const material = materialsBySlot[materialSlot];

            if (!(material instanceof Material)) {
                throw new TypeError(
                    `MeshRenderer requires a Material for slot "${materialSlot}".`,
                );
            }

            normalizedMaterials[materialSlot] = material;
        }

        for (const materialSlot of Object.keys(materialsBySlot)) {
            if (!validSlots.has(materialSlot)) {
                throw new Error(
                    `Mesh has no material slot named "${materialSlot}".`,
                );
            }
        }

        this.mesh = mesh;
        this._materialsBySlot = Object.freeze(normalizedMaterials);
    }

    get MaterialsBySlot() {
        return this._materialsBySlot;
    }

    GetMaterialForSlot(materialSlot) {
        return this._materialsBySlot[materialSlot];
    }
}
