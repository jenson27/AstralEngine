import { Material } from "./material.js";
import { Mesh } from "./mesh.js";

function ValidateTransform(transform) {
    if (!(transform instanceof Float32Array) || transform.length !== 16) {
        throw new TypeError("Model primitive transform must contain 16 values.");
    }

    if (!transform.every(Number.isFinite)) {
        throw new RangeError("Model primitive transform must be finite.");
    }

    return transform.slice();
}

export class ModelAsset {
    constructor(primitives, images = []) {
        if (!Array.isArray(primitives) || primitives.length === 0) {
            throw new TypeError("Model asset requires at least one primitive.");
        }

        const normalizedPrimitives = primitives.map((primitive) => {
            if (
                !primitive ||
                !(primitive.mesh instanceof Mesh) ||
                !(primitive.material instanceof Material)
            ) {
                throw new TypeError(
                    "Model primitives require a Mesh and a Material.",
                );
            }

            return Object.freeze({
                mesh: primitive.mesh,
                material: primitive.material,
                transform: ValidateTransform(primitive.transform),
            });
        });

        if (!Array.isArray(images)) {
            throw new TypeError("Model images must be an array.");
        }

        for (const image of images) {
            if (
                !image?.bitmap ||
                !Number.isSafeInteger(image.width) ||
                image.width <= 0 ||
                !Number.isSafeInteger(image.height) ||
                image.height <= 0
            ) {
                throw new TypeError("Model asset contains an invalid image.");
            }
        }

        this._primitives = Object.freeze(normalizedPrimitives);
        this._images = Object.freeze([...new Set(images)]);
    }

    get Primitives() {
        return this._primitives;
    }

    get Images() {
        return this._images;
    }

    get MemoryUsageBytes() {
        const meshes = new Set(this._primitives.map(({ mesh }) => mesh));
        let bytes = 0;

        for (const mesh of meshes) {
            bytes += mesh.MemoryUsageBytes;
        }

        for (const image of this._images) {
            bytes += image.width * image.height * 4;
        }

        return bytes;
    }

    get MemoryUsageEstimated() {
        return this._images.length > 0;
    }
}
