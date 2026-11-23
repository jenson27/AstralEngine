function CreateDefaultNormals(positions, indices) {
    const normals = new Float32Array(positions.length);
    const vertexCount = positions.length / 3;
    const elementCount = indices?.length ?? vertexCount;
    const readIndex = (index) => indices?.[index] ?? index;

    for (let index = 0; index < elementCount; index += 3) {
        const first = readIndex(index) * 3;
        const second = readIndex(index + 1) * 3;
        const third = readIndex(index + 2) * 3;
        const edgeA = [
            positions[second] - positions[first],
            positions[second + 1] - positions[first + 1],
            positions[second + 2] - positions[first + 2],
        ];
        const edgeB = [
            positions[third] - positions[first],
            positions[third + 1] - positions[first + 1],
            positions[third + 2] - positions[first + 2],
        ];
        const normal = [
            edgeA[1] * edgeB[2] - edgeA[2] * edgeB[1],
            edgeA[2] * edgeB[0] - edgeA[0] * edgeB[2],
            edgeA[0] * edgeB[1] - edgeA[1] * edgeB[0],
        ];
        for (const vertex of [first, second, third]) {
            normals[vertex] += normal[0];
            normals[vertex + 1] += normal[1];
            normals[vertex + 2] += normal[2];
        }
    }

    for (let index = 0; index < normals.length; index += 3) {
        const length = Math.hypot(normals[index], normals[index + 1], normals[index + 2]);
        if (length > 0) {
            normals[index] /= length;
            normals[index + 1] /= length;
            normals[index + 2] /= length;
        } else {
            normals[index + 1] = 1;
        }
    }
    return normals;
}

function ValidateVertexAttribute(values, expectedLength, name) {
    if (!(values instanceof Float32Array) || values.length !== expectedLength) {
        throw new TypeError(`Mesh ${name} must contain ${expectedLength} float values.`);
    }
    if (!values.every(Number.isFinite)) {
        throw new RangeError(`Mesh ${name} must contain finite values.`);
    }
}

function ValidateVertexData(positions, uvs, indices, attributes) {
    if (!(positions instanceof Float32Array)) {
        throw new TypeError("Mesh positions must be a Float32Array.");
    }

    if (positions.length === 0 || positions.length % 3 !== 0) {
        throw new RangeError("Mesh positions must contain complete xyz values.");
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

    if (!positions.every(Number.isFinite)) {
        throw new RangeError(
            "Mesh positions must contain finite values.",
        );
    }

    if (!uvs.every(Number.isFinite)) {
        throw new RangeError("Mesh UVs must contain finite values.");
    }

    if (
        indices !== null &&
        !(indices instanceof Uint16Array) &&
        !(indices instanceof Uint32Array)
    ) {
        throw new TypeError("Mesh indices must be a Uint16Array or Uint32Array.");
    }

    const elementCount = indices?.length ?? vertexCount;
    if (elementCount === 0 || elementCount % 3 !== 0) {
        throw new RangeError("Mesh draw data must contain complete triangles.");
    }
    if (indices && !indices.every((index) => index < vertexCount)) {
        throw new RangeError("Mesh index references a missing vertex.");
    }

    const normals = attributes.normals ?? CreateDefaultNormals(positions, indices);
    const texCoord1 = attributes.texCoord1 ?? new Float32Array(vertexCount * 2);
    const colors = attributes.colors ?? new Float32Array(vertexCount * 4).fill(1);
    ValidateVertexAttribute(normals, vertexCount * 3, "normals");
    ValidateVertexAttribute(texCoord1, vertexCount * 2, "TEXCOORD_1");
    ValidateVertexAttribute(colors, vertexCount * 4, "colors");

    return { vertexCount, elementCount, normals, texCoord1, colors };
}

export class Mesh {
    constructor(positions, uvs, submeshes = null, indices = null, attributes = {}) {
        if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
            throw new TypeError("Mesh vertex attributes must be an object.");
        }
        const { vertexCount, elementCount, normals, texCoord1, colors } = ValidateVertexData(
            positions,
            uvs,
            indices,
            attributes,
        );
        const indexed = indices !== null;

        const sourceSubmeshes = submeshes ?? [
            {
                materialSlot: "default",
                ...(indexed
                    ? { firstIndex: 0, indexCount: elementCount }
                    : { firstVertex: 0, vertexCount: elementCount }),
            },
        ];

        const normalizedSubmeshes = this._CreateNormalizedSubmeshes(
            sourceSubmeshes,
            elementCount,
            indexed,
        );
        this._ValidateSubmeshCoverage(normalizedSubmeshes, elementCount, indexed);

        this._positions = positions.slice();
        this._uvs = uvs.slice();
        this._normals = normals.slice();
        this._texCoord1 = texCoord1.slice();
        this._colors = colors.slice();
        this._indices = indices?.slice() ?? null;
        this._submeshes = Object.freeze(normalizedSubmeshes);
    }

    _CreateNormalizedSubmeshes(sourceSubmeshes, elementCount, indexed) {
        if (!Array.isArray(sourceSubmeshes) || sourceSubmeshes.length === 0) {
            throw new TypeError("Mesh must have at least one submesh.");
        }

        const seenSlots = new Set();

        return sourceSubmeshes.map((submesh) => {
            if (!submesh || typeof submesh !== "object") {
                throw new TypeError("Each submesh must be an object.");
            }

            const { materialSlot } = submesh;
            const firstElement = indexed ? submesh.firstIndex : submesh.firstVertex;
            const submeshElementCount = indexed
                ? submesh.indexCount
                : submesh.vertexCount;

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
                !Number.isSafeInteger(firstElement) ||
                firstElement < 0 ||
                !Number.isSafeInteger(submeshElementCount) ||
                submeshElementCount <= 0 ||
                submeshElementCount % 3 !== 0 ||
                firstElement + submeshElementCount > elementCount
            ) {
                throw new RangeError("Submesh vertex range is invalid.");
            }

            seenSlots.add(materialSlot);

            return Object.freeze(indexed
                ? { materialSlot, firstIndex: firstElement, indexCount: submeshElementCount }
                : { materialSlot, firstVertex: firstElement, vertexCount: submeshElementCount });
        });
    }

    _ValidateSubmeshCoverage(submeshes, elementCount, indexed) {
        const startKey = indexed ? "firstIndex" : "firstVertex";
        const countKey = indexed ? "indexCount" : "vertexCount";
        const orderedSubmeshes = [...submeshes].sort(
            (a, b) => a[startKey] - b[startKey],
        );
        let expectedFirstElement = 0;

        for (const submesh of orderedSubmeshes) {
            if (submesh[startKey] !== expectedFirstElement) {
                throw new RangeError(
                    "Submesh ranges must cover the draw data without gaps or overlap.",
                );
            }

            expectedFirstElement += submesh[countKey];
        }

        if (expectedFirstElement !== elementCount) {
            throw new RangeError(
                "Submesh ranges must cover all mesh draw data.",
            );
        }
    }

    get VertexCount() {
        return this._positions.length / 3;
    }

    get MemoryUsageBytes() {
        return this._positions.byteLength + this._uvs.byteLength +
            this._normals.byteLength + this._texCoord1.byteLength +
            this._colors.byteLength +
            (this._indices?.byteLength ?? 0);
    }

    get IndexCount() {
        return this._indices?.length ?? 0;
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

    GetNormals() {
        return this._normals.slice();
    }

    GetTexCoord1() {
        return this._texCoord1.slice();
    }

    GetColors() {
        return this._colors.slice();
    }

    GetIndices() {
        return this._indices?.slice() ?? null;
    }
}
