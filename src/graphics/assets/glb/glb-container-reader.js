const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const BIN_CHUNK_TYPE = 0x004e4942;
const DATA_URI_PATTERN = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i;

export function RequireObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`${label} must be an object.`);
    }

    return value;
}

export function RequireIndex(value, length, label) {
    if (!Number.isSafeInteger(value) || value < 0 || value >= length) {
        throw new RangeError(`${label} index is out of range.`);
    }

    return value;
}

export function ReadGlbContainer(arrayBuffer) {
    if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength < 20) {
        throw new TypeError("GLB file is too short to contain a header and JSON chunk.");
    }

    const dataView = new DataView(arrayBuffer);
    if (dataView.getUint32(0, true) !== GLB_MAGIC) {
        throw new Error("GLB header has an invalid magic value.");
    }
    if (dataView.getUint32(4, true) !== GLB_VERSION) {
        throw new Error("Only GLB container version 2 is supported.");
    }

    const declaredLength = dataView.getUint32(8, true);
    if (declaredLength !== arrayBuffer.byteLength) {
        throw new RangeError("GLB header length does not match the file size.");
    }

    let offset = 12;
    let jsonChunk = null;
    let binaryChunk = null;
    let chunkIndex = 0;

    while (offset < declaredLength) {
        if (offset + 8 > declaredLength) {
            throw new RangeError("GLB contains a truncated chunk header.");
        }

        const chunkLength = dataView.getUint32(offset, true);
        const chunkType = dataView.getUint32(offset + 4, true);
        const chunkStart = offset + 8;
        const chunkEnd = chunkStart + chunkLength;

        if (chunkLength % 4 !== 0 || chunkEnd > declaredLength) {
            throw new RangeError("GLB contains an invalid or truncated chunk.");
        }

        const chunkBytes = new Uint8Array(arrayBuffer, chunkStart, chunkLength);
        if (chunkIndex === 0 && chunkType !== JSON_CHUNK_TYPE) {
            throw new Error("GLB JSON must be the first chunk.");
        }

        if (chunkType === JSON_CHUNK_TYPE) {
            if (jsonChunk) {
                throw new Error("GLB contains more than one JSON chunk.");
            }
            jsonChunk = chunkBytes;
        } else if (chunkType === BIN_CHUNK_TYPE) {
            if (binaryChunk || !jsonChunk) {
                throw new Error("GLB contains an invalid BIN chunk.");
            }
            binaryChunk = chunkBytes;
        }

        offset = chunkEnd;
        chunkIndex += 1;
    }

    if (!jsonChunk) {
        throw new Error("GLB does not contain a JSON chunk.");
    }

    let document;
    try {
        const jsonText = new TextDecoder("utf-8", { fatal: true })
            .decode(jsonChunk)
            .replace(/\0+$/g, "")
            .trimEnd();
        document = JSON.parse(jsonText);
    } catch (error) {
        throw new Error("GLB JSON chunk is invalid.", { cause: error });
    }

    RequireObject(document, "GLB document");
    if (document.asset?.version !== "2.0") {
        throw new Error("Only glTF 2.0 assets in a GLB container are supported.");
    }

    return { document, binaryChunk };
}

export function DecodeDataUri(uri, label) {
    const match = DATA_URI_PATTERN.exec(uri);
    if (!match) {
        throw new Error(`${label} has an invalid data URI.`);
    }

    const [, mimeType = "application/octet-stream", base64Marker, payload] = match;
    if (base64Marker) {
        let binary;
        try {
            binary = atob(payload);
        } catch (error) {
            throw new Error(`${label} data URI has invalid base64 data.`, {
                cause: error,
            });
        }

        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }
        return { mimeType, bytes };
    }

    const bytes = new Uint8Array(payload.length);
    let byteLength = 0;
    for (let index = 0; index < payload.length; index += 1) {
        if (payload[index] === "%") {
            const hex = payload.slice(index + 1, index + 3);
            if (!/^[\da-f]{2}$/i.test(hex)) {
                throw new Error(`${label} data URI has invalid encoded data.`);
            }
            bytes[byteLength] = Number.parseInt(hex, 16);
            byteLength += 1;
            index += 2;
            continue;
        }

        const byte = payload.charCodeAt(index);
        if (byte > 0x7f) {
            throw new Error(`${label} data URI has an unescaped non-ASCII byte.`);
        }
        bytes[byteLength] = byte;
        byteLength += 1;
    }

    return { mimeType, bytes: bytes.subarray(0, byteLength) };
}

export function ReadBuffers(document, binaryChunk) {
    const bufferDefinitions = document.buffers ?? [];
    if (!Array.isArray(bufferDefinitions)) {
        throw new TypeError("GLB buffers must be an array.");
    }

    return bufferDefinitions.map((buffer, index) => {
        RequireObject(buffer, `GLB buffer ${index}`);
        if (!Number.isSafeInteger(buffer.byteLength) || buffer.byteLength < 0) {
            throw new RangeError(`GLB buffer ${index} has an invalid byte length.`);
        }

        let bytes;
        if (buffer.uri === undefined && index === 0) {
            if (!binaryChunk) {
                throw new Error("GLB buffer 0 has no BIN chunk.");
            }
            if (binaryChunk.byteLength < buffer.byteLength ||
                binaryChunk.byteLength > buffer.byteLength + 3) {
                throw new RangeError("GLB BIN chunk length does not match buffer 0.");
            }
            bytes = binaryChunk.subarray(0, buffer.byteLength);
        } else if (typeof buffer.uri === "string" && buffer.uri.startsWith("data:")) {
            bytes = DecodeDataUri(buffer.uri, `GLB buffer ${index}`).bytes;
            if (bytes.byteLength < buffer.byteLength) {
                throw new RangeError(`GLB buffer ${index} is shorter than declared.`);
            }
            bytes = bytes.subarray(0, buffer.byteLength);
        } else {
            throw new Error(
                `GLB buffer ${index} uses an external resource, which this loader does not support.`,
            );
        }

        return bytes;
    });
}

export function GetBufferView(document, buffers, bufferViewIndex, label) {
    const bufferViews = document.bufferViews ?? [];
    if (!Array.isArray(bufferViews)) {
        throw new TypeError("GLB bufferViews must be an array.");
    }

    const bufferView = RequireObject(
        bufferViews[RequireIndex(bufferViewIndex, bufferViews.length, label)],
        `${label} bufferView`,
    );
    const bufferIndex = RequireIndex(
        bufferView.buffer,
        buffers.length,
        `${label} buffer`,
    );
    const byteOffset = bufferView.byteOffset ?? 0;
    const byteLength = bufferView.byteLength;

    if (
        !Number.isSafeInteger(byteOffset) ||
        byteOffset < 0 ||
        !Number.isSafeInteger(byteLength) ||
        byteLength < 0 ||
        byteOffset + byteLength > buffers[bufferIndex].byteLength
    ) {
        throw new RangeError(`${label} bufferView range is invalid.`);
    }

    return {
        definition: bufferView,
        bytes: buffers[bufferIndex].subarray(byteOffset, byteOffset + byteLength),
    };
}
