import {
    GetBufferView,
    RequireIndex,
    RequireObject,
} from "./glb-container-reader.js";

const COMPONENT_BYTE_LENGTHS = Object.freeze({
    5121: 1,
    5123: 2,
    5125: 4,
    5126: 4,
});

function GetAccessorLayout(document, buffers, accessorIndex, expectedType, label) {
    const accessors = document.accessors ?? [];
    if (!Array.isArray(accessors)) {
        throw new TypeError("GLB accessors must be an array.");
    }

    const accessor = RequireObject(
        accessors[RequireIndex(accessorIndex, accessors.length, label)],
        `${label} accessor`,
    );
    if (accessor.type !== expectedType) {
        throw new Error(`${label} accessor must use ${expectedType} values.`);
    }
    if (accessor.sparse) {
        throw new Error(`${label} sparse accessors are not supported.`);
    }
    if (!Number.isSafeInteger(accessor.count) || accessor.count <= 0) {
        throw new RangeError(`${label} accessor has an invalid element count.`);
    }
    if (!Number.isSafeInteger(accessor.componentType) ||
        !COMPONENT_BYTE_LENGTHS[accessor.componentType]) {
        throw new Error(`${label} accessor has an unsupported component type.`);
    }

    const { definition: bufferView, bytes } = GetBufferView(
        document,
        buffers,
        accessor.bufferView,
        label,
    );
    const componentByteLength = COMPONENT_BYTE_LENGTHS[accessor.componentType];
    const componentCount = expectedType === "VEC3"
        ? 3
        : expectedType === "VEC2"
          ? 2
          : 1;
    const elementByteLength = componentCount * componentByteLength;
    const byteStride = bufferView.byteStride ?? elementByteLength;
    const accessorByteOffset = accessor.byteOffset ?? 0;

    if (
        !Number.isSafeInteger(byteStride) ||
        byteStride < elementByteLength ||
        byteStride % componentByteLength !== 0 ||
        !Number.isSafeInteger(accessorByteOffset) ||
        accessorByteOffset < 0 ||
        accessorByteOffset % componentByteLength !== 0 ||
        accessorByteOffset + (accessor.count - 1) * byteStride + elementByteLength > bytes.byteLength
    ) {
        throw new RangeError(`${label} accessor range or stride is invalid.`);
    }

    return {
        accessor,
        dataView: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        accessorByteOffset,
        byteStride,
        componentByteLength,
    };
}

export function ReadPositions(document, buffers, accessorIndex) {
    const layout = GetAccessorLayout(
        document,
        buffers,
        accessorIndex,
        "VEC3",
        "POSITION",
    );
    if (layout.accessor.componentType !== 5126 || layout.accessor.normalized) {
        throw new Error("POSITION must contain non-normalized float values.");
    }

    const values = new Float32Array(layout.accessor.count * 3);
    for (let vertexIndex = 0; vertexIndex < layout.accessor.count; vertexIndex += 1) {
        const elementOffset = layout.accessorByteOffset + vertexIndex * layout.byteStride;
        for (let component = 0; component < 3; component += 1) {
            values[vertexIndex * 3 + component] = layout.dataView.getFloat32(
                elementOffset + component * 4,
                true,
            );
        }
    }
    if (!values.every(Number.isFinite)) {
        throw new RangeError("POSITION contains a non-finite value.");
    }
    return values;
}

export function ReadUvs(document, buffers, accessorIndex, vertexCount) {
    if (accessorIndex === undefined) {
        return new Float32Array(vertexCount * 2);
    }

    const layout = GetAccessorLayout(
        document,
        buffers,
        accessorIndex,
        "VEC2",
        "TEXCOORD_0",
    );
    const { componentType, normalized } = layout.accessor;
    if (
        componentType !== 5126 &&
        !((componentType === 5121 || componentType === 5123) && normalized)
    ) {
        throw new Error(
            "TEXCOORD_0 must use floats or normalized unsigned byte or short values.",
        );
    }
    if (layout.accessor.count !== vertexCount) {
        throw new RangeError("TEXCOORD_0 count must match POSITION count.");
    }

    const values = new Float32Array(vertexCount * 2);
    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
        const elementOffset = layout.accessorByteOffset + vertexIndex * layout.byteStride;
        for (let component = 0; component < 2; component += 1) {
            const offset = elementOffset + component * layout.componentByteLength;
            let value;
            if (componentType === 5126) {
                value = layout.dataView.getFloat32(offset, true);
            } else if (componentType === 5121) {
                value = layout.dataView.getUint8(offset) / 255;
            } else {
                value = layout.dataView.getUint16(offset, true) / 65535;
            }
            if (!Number.isFinite(value)) {
                throw new RangeError("TEXCOORD_0 contains a non-finite value.");
            }
            values[vertexIndex * 2 + component] = value;
        }
    }
    return values;
}

export function ReadIndices(document, buffers, accessorIndex, vertexCount) {
    if (accessorIndex === undefined) {
        if (vertexCount % 3 !== 0) {
            throw new RangeError("Unindexed triangle meshes need a vertex count divisible by three.");
        }
        return null;
    }

    const layout = GetAccessorLayout(
        document,
        buffers,
        accessorIndex,
        "SCALAR",
        "Indices",
    );
    if (![5121, 5123, 5125].includes(layout.accessor.componentType) || layout.accessor.normalized) {
        throw new Error("Mesh indices must use unsigned byte, short, or integer values.");
    }

    const indices = new Uint32Array(layout.accessor.count);
    for (let index = 0; index < indices.length; index += 1) {
        const offset = layout.accessorByteOffset + index * layout.byteStride;
        if (layout.accessor.componentType === 5121) {
            indices[index] = layout.dataView.getUint8(offset);
        } else if (layout.accessor.componentType === 5123) {
            indices[index] = layout.dataView.getUint16(offset, true);
        } else {
            indices[index] = layout.dataView.getUint32(offset, true);
        }
        if (indices[index] >= vertexCount) {
            throw new RangeError("Mesh index references a missing vertex.");
        }
    }
    if (indices.length === 0 || indices.length % 3 !== 0) {
        throw new RangeError("Triangle mesh indices must be non-empty and divisible by three.");
    }
    return vertexCount <= 0x10000
        ? Uint16Array.from(indices)
        : indices;
}
