import assert from "node:assert/strict";
import test from "node:test";
import {
    ReadColors,
    ReadNormals,
    ReadPositions,
    ReadUvs,
} from "../src/graphics/assets/glb/gltf-accessor-reader.js";

function CreateAccessorFixture() {
    const bytes = new Uint8Array(104);
    const view = new DataView(bytes.buffer);
    const vertices = [
        [0, 0, 0, 0, 0],
        [1, 0, 0, 1, 0],
        [0, 1, 0, 0, 1],
    ];
    for (let index = 0; index < vertices.length; index += 1) {
        const offset = index * 32;
        const [x, y, z, u, v] = vertices[index];
        [x, y, z, u, v, 0, 0, 1].forEach((value, component) =>
            view.setFloat32(offset + component * 4, value, true),
        );
    }
    bytes[96] = 1;
    bytes.set([255, 128, 0, 255], 100);
    return {
        buffers: [bytes],
        document: {
            bufferViews: [
                { buffer: 0, byteLength: 96, byteStride: 32 },
                { buffer: 0, byteOffset: 96, byteLength: 1 },
                { buffer: 0, byteOffset: 100, byteLength: 4 },
            ],
            accessors: [
                { bufferView: 0, componentType: 5126, byteOffset: 0, count: 3, type: "VEC3" },
                { bufferView: 0, componentType: 5126, byteOffset: 12, count: 3, type: "VEC2" },
                { bufferView: 0, componentType: 5126, byteOffset: 20, count: 3, type: "VEC3" },
                {
                    componentType: 5121,
                    count: 3,
                    normalized: true,
                    type: "VEC4",
                    sparse: {
                        count: 1,
                        indices: { bufferView: 1, componentType: 5121 },
                        values: { bufferView: 2 },
                    },
                },
            ],
        },
    };
}

test("reads interleaved vertex attributes and normalized sparse colors", () => {
    const { document, buffers } = CreateAccessorFixture();

    assert.deepEqual(
        Array.from(ReadPositions(document, buffers, 0)),
        [0, 0, 0, 1, 0, 0, 0, 1, 0],
    );
    assert.deepEqual(
        Array.from(ReadUvs(document, buffers, 1, 3)),
        [0, 0, 1, 0, 0, 1],
    );
    assert.deepEqual(
        Array.from(ReadNormals(document, buffers, 2, 3)),
        [0, 0, 1, 0, 0, 1, 0, 0, 1],
    );
    const colors = ReadColors(document, buffers, 3, 3);
    assert.equal(colors[4], 1);
    assert.ok(Math.abs(colors[5] - 128 / 255) < 1e-7);
    assert.equal(colors[6], 0);
    assert.equal(colors[7], 1);
    assert.deepEqual(Array.from(colors.slice(0, 4)), [0, 0, 0, 0]);
});

test("rejects sparse accessor indices that are not increasing", () => {
    const { document, buffers } = CreateAccessorFixture();
    buffers[0][96] = 3;

    assert.throws(
        () => ReadColors(document, buffers, 3, 3),
        /sparse indices are out of range or not increasing/,
    );
});
