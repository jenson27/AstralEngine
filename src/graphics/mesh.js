export class Mesh {
    constructor(positions, uvs, submeshes = null) {
        if (!(positions instanceof Float32Array)) {
            throw new TypeError("Mesh positions must be a Float32Array.");
        }

        if (positions.length === 0 || positions.length % 9 !== 0) {
            throw new RangeError(
                "Mesh positions must contain complete xyz triangles.",
            );
        }

        if (!(uvs instanceof Float32Array)) {
            throw new TypeError("Mesh UVs must be a Float32Array.");
        }

        const vertexCount = positions.length / 3;

        if (uvs.length !== vertexCount * 2) {
            throw new RangeError(
                "Mesh must have one uv pair for each vertex.",
            );
        }

        const sourceSubmeshes = submeshes ?? [
            {
                materialSlot: "default",
                firstVertex: 0,
                vertexCount,
            },
        ];

        if (!Array.isArray(sourceSubmeshes) || sourceSubmeshes.length === 0) {
            throw new TypeError("Mesh must have at least one submesh.");
        }

        const seenSlots = new Set();
        const normalizedSubmeshes = sourceSubmeshes.map((submesh) => {
            if (!submesh || typeof submesh !== "object") {
                throw new TypeError("Each submesh must be an object.");
            }

            const { materialSlot, firstVertex, vertexCount: submeshVertexCount } =
                submesh;

            if (
                typeof materialSlot !== "string" ||
                materialSlot.trim() === ""
            ) {
                throw new TypeError(
                    "Submesh material slot must be a non-empty string.",
                );
            }

            if (seenSlots.has(materialSlot)) {
                throw new Error(
                    "Mesh material slots must be unique: " + materialSlot,
                );
            }

            if (
                !Number.isSafeInteger(firstVertex) ||
                firstVertex < 0 ||
                !Number.isSafeInteger(submeshVertexCount) ||
                submeshVertexCount <= 0 ||
                submeshVertexCount % 3 !== 0 ||
                firstVertex + submeshVertexCount > vertexCount
            ) {
                throw new RangeError("Submesh vertex range is invalid.");
            }

            seenSlots.add(materialSlot);

            return Object.freeze({
                materialSlot,
                firstVertex,
                vertexCount: submeshVertexCount,
            });
        });

        const orderedSubmeshes = [...normalizedSubmeshes].sort(
            (a, b) => a.firstVertex - b.firstVertex,
        );
        let expectedFirstVertex = 0;

        for (const submesh of orderedSubmeshes) {
            if (submesh.firstVertex !== expectedFirstVertex) {
                throw new RangeError(
                    "Submesh ranges must cover the mesh without gaps or overlap.",
                );
            }

            expectedFirstVertex += submesh.vertexCount;
        }

        if (expectedFirstVertex !== vertexCount) {
            throw new RangeError(
                "Submesh ranges must cover every mesh vertex.",
            );
        }

        this._positions = positions.slice();
        this._uvs = uvs.slice();
        this._submeshes = Object.freeze(normalizedSubmeshes);
    }

    get VertexCount() {
        return this._positions.length / 3;
    }

    get Submeshes() {
        return this._submeshes;
    }

    GetPositions() {
        return this._positions.slice();
    }

    GetUVs() {
        return this._uvs.slice();
    }
}
