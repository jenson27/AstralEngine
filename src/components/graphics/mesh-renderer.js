import { AssetHandle } from "../../core/assets/asset-handle.js";
import { Mesh } from "../../graphics/mesh.js";
import { Material } from "../../graphics/material.js";

export class MeshRenderer {
    constructor(meshHandle, materialHandlesBySlot) {
        if (!(meshHandle instanceof AssetHandle)) {
            throw new TypeError("MeshRenderer requires a mesh asset handle.");
        }

        if (
            !materialHandlesBySlot ||
            typeof materialHandlesBySlot !== "object" ||
            Array.isArray(materialHandlesBySlot)
        ) {
            throw new TypeError(
                "MeshRenderer requires material handles keyed by mesh slot.",
            );
        }

        const mesh = meshHandle.Current;

        if (!(mesh instanceof Mesh)) {
            throw new TypeError(
                "MeshRenderer mesh handle must contain a Mesh.",
            );
        }

        const normalizedHandles = Object.create(null);
        const validSlots = new Set();

        for (const { materialSlot } of mesh.Submeshes) {
            validSlots.add(materialSlot);

            const materialHandle = materialHandlesBySlot[materialSlot];

            if (!(materialHandle instanceof AssetHandle)) {
                throw new TypeError(
                    `MeshRenderer requires a material handle for slot "${materialSlot}".`,
                );
            }

            if (!(materialHandle.Current instanceof Material)) {
                throw new TypeError(
                    `Material handle for slot "${materialSlot}" must contain a Material.`,
                );
            }

            normalizedHandles[materialSlot] = materialHandle;
        }

        for (const materialSlot of Object.keys(materialHandlesBySlot)) {
            if (!validSlots.has(materialSlot)) {
                throw new Error(
                    `Mesh has no material slot named "${materialSlot}".`,
                );
            }
        }

        this._meshHandle = meshHandle;
        this._materialHandlesBySlot = Object.freeze(normalizedHandles);
    }

    get mesh() {
        return this._meshHandle.Current;
    }

    get MeshHandle() {
        return this._meshHandle;
    }

    get MaterialsBySlot() {
        const materialsBySlot = Object.create(null);

        for (const [materialSlot, handle] of Object.entries(
            this._materialHandlesBySlot,
        )) {
            materialsBySlot[materialSlot] = handle.Current;
        }

        return Object.freeze(materialsBySlot);
    }

    get MaterialHandlesBySlot() {
        return this._materialHandlesBySlot;
    }

    GetMaterialForSlot(materialSlot) {
        return this._materialHandlesBySlot[materialSlot]?.Current;
    }

    GetMaterialHandleForSlot(materialSlot) {
        return this._materialHandlesBySlot[materialSlot];
    }
}
