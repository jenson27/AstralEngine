import {
    GetBufferView,
    RequireIndex,
    RequireObject,
} from "./glb-container-reader.js";

const COMPONENT_INFO = Object.freeze({
    5120: { bytes: 1, read: "getInt8", signed: true },
    5121: { bytes: 1, read: "getUint8", signed: false },
    5122: { bytes: 2, read: "getInt16", signed: true },
    5123: { bytes: 2, read: "getUint16", signed: false },
    5125: { bytes: 4, read: "getUint32", signed: false },
    5126: { bytes: 4, read: "getFloat32", signed: true },
});
const COMPONENT_COUNTS = Object.freeze({
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
});

function ReadComponent(dataView, componentType, byteOffset) {
    const { read } = COMPONENT_INFO[componentType];
    return dataView[read](byteOffset, true);
}

function DecodeNormalized(value, componentType) {
    if (componentType === 5120) {
        return Math.max(value / 127, -1);
    }
    if (componentType === 5121) {
        return value / 255;
    }
    if (componentType === 5122) {
        return Math.max(value / 32767, -1);
    }
    if (componentType === 5123) {
        return value / 65535;
    }
    return value;
}

function ReadAccessorLayout(document, buffers, accessorIndex, label) {
    const accessors = document.accessors ?? [];
    if (!Array.isArray(accessors)) {
        throw new TypeError("GLB accessors must be an array.");
    }

    const accessor = RequireObject(
        accessors[RequireIndex(accessorIndex, accessors.length, label)],
        `${label} accessor`,
    );
    const componentCount = COMPONENT_COUNTS[accessor.type];
    const componentInfo = COMPONENT_INFO[accessor.componentType];
    if (!componentCount || !componentInfo) {
        throw new Error(`${label} accessor has an unsupported type or component type.`);
    }
    if (!Number.isSafeInteger(accessor.count) || accessor.count <= 0) {
        throw new RangeError(`${label} accessor has an invalid element count.`);
    }
    if (accessor.normalized !== undefined && typeof accessor.normalized !== "boolean") {
        throw new TypeError(`${label} accessor normalized flag must be boolean.`);
    }

    const elementByteLength = componentCount * componentInfo.bytes;
    const values = new Float64Array(accessor.count * componentCount);
    if (accessor.bufferView !== undefined) {
        const { definition: bufferView, bytes } = GetBufferView(
            document,
            buffers,
            accessor.bufferView,
            label,
        );
        const byteStride = bufferView.byteStride ?? elementByteLength;
        const accessorByteOffset = accessor.byteOffset ?? 0;
        if (
            !Number.isSafeInteger(byteStride) ||
            byteStride < elementByteLength ||
            byteStride > 252 ||
            (bufferView.byteStride !== undefined && byteStride % 4 !== 0) ||
            !Number.isSafeInteger(accessorByteOffset) ||
            accessorByteOffset < 0 ||
            accessorByteOffset % componentInfo.bytes !== 0 ||
            ((bufferView.byteOffset ?? 0) + accessorByteOffset) % componentInfo.bytes !== 0 ||
            accessorByteOffset + (accessor.count - 1) * byteStride + elementByteLength > bytes.byteLength
        ) {
            throw new RangeError(`${label} accessor range or stride is invalid.`);
        }

        const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let elementIndex = 0; elementIndex < accessor.count; elementIndex += 1) {
            const elementOffset = accessorByteOffset + elementIndex * byteStride;
            for (let componentIndex = 0; componentIndex < componentCount; componentIndex += 1) {
                const value = ReadComponent(
                    dataView,
                    accessor.componentType,
                    elementOffset + componentIndex * componentInfo.bytes,
                );
                values[elementIndex * componentCount + componentIndex] =
                    accessor.normalized
                        ? DecodeNormalized(value, accessor.componentType)
                        : value;
            }
        }
    }

    if (accessor.sparse !== undefined) {
        ApplySparseValues(
            document,
            buffers,
            accessor.sparse,
            accessor,
            componentCount,
            componentInfo.bytes,
            values,
            label,
        );
    } else if (accessor.bufferView === undefined) {
        throw new Error(`${label} accessor has no bufferView or sparse values.`);
    }

    if (!values.every(Number.isFinite)) {
        throw new RangeError(`${label} accessor contains a non-finite value.`);
    }
    return { accessor, componentCount, values };
}

function ReadSparseView(
    document,
    buffers,
    sparseView,
    label,
    byteLength,
    alignment,
) {
    const { definition, bytes } = GetBufferView(
        document,
        buffers,
        sparseView.bufferView,
        label,
    );
    if (definition.byteStride !== undefined) {
        throw new Error(`${label} sparse bufferView must not define byteStride.`);
    }
    const byteOffset = sparseView.byteOffset ?? 0;
    if (
        !Number.isSafeInteger(byteOffset) ||
        byteOffset < 0 ||
        byteOffset % alignment !== 0 ||
        ((definition.byteOffset ?? 0) + byteOffset) % alignment !== 0 ||
        byteOffset + byteLength > bytes.byteLength
    ) {
        throw new RangeError(`${label} sparse bufferView range is invalid.`);
    }
    return { bytes, byteOffset };
}

function ApplySparseValues(
    document,
    buffers,
    sparse,
    accessor,
    componentCount,
    componentByteLength,
    target,
    label,
) {
    RequireObject(sparse, `${label} sparse data`);
    if (
        !Number.isSafeInteger(sparse.count) ||
        sparse.count <= 0 ||
        sparse.count > accessor.count
    ) {
        throw new RangeError(`${label} sparse count is invalid.`);
    }
    const indices = RequireObject(sparse.indices, `${label} sparse indices`);
    const indexInfo = COMPONENT_INFO[indices.componentType];
    if (![5121, 5123, 5125].includes(indices.componentType) || !indexInfo) {
        throw new Error(`${label} sparse indices must use unsigned integer values.`);
    }
    const indexData = ReadSparseView(
        document,
        buffers,
        indices,
        `${label} sparse indices`,
        sparse.count * indexInfo.bytes,
        indexInfo.bytes,
    );
    const indexView = new DataView(
        indexData.bytes.buffer,
        indexData.bytes.byteOffset,
        indexData.bytes.byteLength,
    );
    const indexRead = indexInfo.read;
    let previousIndex = -1;
    for (let sparseIndex = 0; sparseIndex < sparse.count; sparseIndex += 1) {
        const targetIndex = indexView[indexRead](
            indexData.byteOffset + sparseIndex * indexInfo.bytes,
            true,
        );
        if (targetIndex <= previousIndex || targetIndex >= accessor.count) {
            throw new RangeError(`${label} sparse indices are out of range or not increasing.`);
        }
        previousIndex = targetIndex;
    }

    const sparseValues = RequireObject(sparse.values, `${label} sparse values`);
    const valueData = ReadSparseView(
        document,
        buffers,
        sparseValues,
        `${label} sparse values`,
        sparse.count * componentCount * componentByteLength,
        componentByteLength,
    );
    const valueView = new DataView(
        valueData.bytes.buffer,
        valueData.bytes.byteOffset,
        valueData.bytes.byteLength,
    );
    for (let sparseIndex = 0; sparseIndex < sparse.count; sparseIndex += 1) {
        const targetIndex = indexView[indexRead](
            indexData.byteOffset + sparseIndex * indexInfo.bytes,
            true,
        );
        for (let componentIndex = 0; componentIndex < componentCount; componentIndex += 1) {
            const sourceOffset = valueData.byteOffset +
                (sparseIndex * componentCount + componentIndex) * componentByteLength;
            const value = ReadComponent(
                valueView,
                accessor.componentType,
                sourceOffset,
            );
            target[targetIndex * componentCount + componentIndex] = accessor.normalized
                ? DecodeNormalized(value, accessor.componentType)
                : value;
        }
    }
}

function RequireAttributeFormat(accessor, label, componentTypes, normalizedValues) {
    if (
        !componentTypes.includes(accessor.componentType) ||
        (accessor.componentType === 5126 && accessor.normalized) ||
        (accessor.componentType !== 5126 && accessor.normalized !== true && normalizedValues)
    ) {
        throw new Error(`${label} accessor uses an unsupported component format.`);
    }
}

export function ReadPositions(document, buffers, accessorIndex) {
    const { accessor, componentCount, values } = ReadAccessorLayout(
        document,
        buffers,
        accessorIndex,
        "POSITION",
    );
    if (accessor.type !== "VEC3" || componentCount !== 3) {
        throw new Error("POSITION accessor must use VEC3 values.");
    }
    RequireAttributeFormat(accessor, "POSITION", [5126], false);
    return Float32Array.from(values);
}

export function ReadNormals(document, buffers, accessorIndex, vertexCount) {
    if (accessorIndex === undefined) {
        return null;
    }
    const { accessor, values } = ReadAccessorLayout(
        document,
        buffers,
        accessorIndex,
        "NORMAL",
    );
    if (accessor.type !== "VEC3" || accessor.count !== vertexCount) {
        throw new RangeError("NORMAL must be VEC3 and match POSITION count.");
    }
    RequireAttributeFormat(accessor, "NORMAL", [5126, 5120, 5122], true);
    for (let index = 0; index < values.length; index += 3) {
        const length = Math.hypot(values[index], values[index + 1], values[index + 2]);
        if (length > 0) {
            values[index] /= length;
            values[index + 1] /= length;
            values[index + 2] /= length;
        }
    }
    return Float32Array.from(values);
}

export function ReadUvs(document, buffers, accessorIndex, vertexCount, set = 0) {
    if (accessorIndex === undefined) {
        return new Float32Array(vertexCount * 2);
    }
    const label = `TEXCOORD_${set}`;
    const { accessor, values } = ReadAccessorLayout(
        document,
        buffers,
        accessorIndex,
        label,
    );
    if (accessor.type !== "VEC2" || accessor.count !== vertexCount) {
        throw new RangeError(`${label} must be VEC2 and match POSITION count.`);
    }
    RequireAttributeFormat(accessor, label, [5126, 5121, 5123], true);
    return Float32Array.from(values);
}

export function ReadColors(document, buffers, accessorIndex, vertexCount) {
    if (accessorIndex === undefined) {
        return new Float32Array(vertexCount * 4).fill(1);
    }
    const { accessor, values } = ReadAccessorLayout(
        document,
        buffers,
        accessorIndex,
        "COLOR_0",
    );
    if (!["VEC3", "VEC4"].includes(accessor.type) || accessor.count !== vertexCount) {
        throw new RangeError("COLOR_0 must be VEC3 or VEC4 and match POSITION count.");
    }
    RequireAttributeFormat(accessor, "COLOR_0", [5126, 5121, 5123], true);
    if (accessor.type === "VEC4") {
        return Float32Array.from(values);
    }
    const colors = new Float32Array(vertexCount * 4);
    for (let index = 0; index < vertexCount; index += 1) {
        colors.set(values.subarray(index * 3, index * 3 + 3), index * 4);
        colors[index * 4 + 3] = 1;
    }
    return colors;
}

export function ReadIndices(document, buffers, accessorIndex, vertexCount) {
    if (accessorIndex === undefined) {
        return null;
    }
    const { accessor, values } = ReadAccessorLayout(
        document,
        buffers,
        accessorIndex,
        "Indices",
    );
    if (accessor.type !== "SCALAR" ||
        ![5121, 5123, 5125].includes(accessor.componentType) ||
        accessor.normalized) {
        throw new Error("Mesh indices must use unsigned byte, short, or integer values.");
    }
    const indices = new Uint32Array(values.length);
    for (let index = 0; index < indices.length; index += 1) {
        if (!Number.isInteger(values[index]) || values[index] >= vertexCount) {
            throw new RangeError("Mesh index references a missing vertex.");
        }
        indices[index] = values[index];
    }
    return vertexCount <= 0x10000 ? Uint16Array.from(indices) : indices;
}
