import assert from "node:assert/strict";
import test from "node:test";
import {
    MultiplyMatrix4,
    SetQuaternionFromEuler,
    SetTRSMatrix,
    SetTRSMatrixFromQuaternion,
    SetViewMatrixFromWorldMatrix,
    SlerpQuaternion,
} from "../../src/math/matrix4.js";

test("builds the same transform matrix from Euler angles and a quaternion", () => {
    const position = [2, -3, 4];
    const rotation = [0.4, -0.8, 1.1];
    const scale = [2, 3, 0.5];
    const quaternion = SetQuaternionFromEuler([0, 0, 0, 1], rotation);
    const eulerMatrix = SetTRSMatrix(
        new Float32Array(16),
        position,
        rotation,
        scale,
    );
    const quaternionMatrix = SetTRSMatrixFromQuaternion(
        new Float32Array(16),
        position,
        quaternion,
        scale,
    );

    for (let index = 0; index < 16; index += 1) {
        assert.ok(
            Math.abs(eulerMatrix[index] - quaternionMatrix[index]) < 1e-6,
        );
    }
});

test("slerps between orientations while keeping a unit quaternion", () => {
    const start = SetQuaternionFromEuler([0, 0, 0, 1], [0, 0, 0]);
    const end = SetQuaternionFromEuler([0, 0, 0, 1], [1.1, -1.2, 0.7]);
    const middle = SlerpQuaternion([0, 0, 0, 1], start, end, 0.5);

    assert.ok(Math.abs(Math.hypot(...middle) - 1) < 1e-10);
});

test("multiplies parent world matrix by child local matrix", () => {
    const parentWorld = SetTRSMatrix(
        new Float32Array(16),
        [5, 0, 0],
        [0, Math.PI / 2, 0],
        [2, 2, 2],
    );
    const childLocal = SetTRSMatrix(
        new Float32Array(16),
        [0, 0, -1],
        [0, 0, 0],
        [1, 1, 1],
    );
    const world = MultiplyMatrix4(
        new Float32Array(16),
        parentWorld,
        childLocal,
    );

    assert.ok(Math.abs(world[12] - 3) < 1e-6);
    assert.ok(Math.abs(world[13]) < 1e-6);
    assert.ok(Math.abs(world[14]) < 1e-6);
});

test("requires a separate output matrix", () => {
    const left = new Float32Array(16);
    const right = new Float32Array(16);

    assert.throws(
        () => MultiplyMatrix4(left, left, right),
        /must not alias/,
    );
});

test("inverts a camera world matrix into its view matrix", () => {
    const worldMatrix = SetTRSMatrix(
        new Float32Array(16),
        [5, 3, -2],
        [0.2, 0.5, -0.3],
        [2, 3, 4],
    );
    const viewMatrix = SetViewMatrixFromWorldMatrix(
        new Float32Array(16),
        worldMatrix,
    );
    const identity = MultiplyMatrix4(
        new Float32Array(16),
        worldMatrix,
        viewMatrix,
    );

    for (let index = 0; index < 16; index += 1) {
        const expected = index % 5 === 0 ? 1 : 0;
        assert.ok(Math.abs(identity[index] - expected) < 1e-5);
    }
});

test("rejects a singular camera world matrix", () => {
    const worldMatrix = SetTRSMatrix(
        new Float32Array(16),
        [0, 0, 0],
        [0, 0, 0],
        [1, 0, 1],
    );

    assert.throws(
        () => SetViewMatrixFromWorldMatrix(new Float32Array(16), worldMatrix),
        /must be invertible/,
    );
});
