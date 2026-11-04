import assert from "node:assert/strict";
import test from "node:test";
import { Transform } from "../../src/components/transform.js";

test("interpolates transforms and follows the shortest quaternion path", () => {
    const transform = new Transform();
    transform.position = [0, 2, 4];
    transform.rotation = [0, Math.PI - 0.1, 0];
    transform.scale = [1, 2, 1];
    transform.CapturePreviousState();

    transform.position = [4, 6, 8];
    transform.rotation = [0, -Math.PI + 0.1, 0];
    transform.scale = [3, 4, 5];

    const state = transform.GetInterpolatedState(0.5);

    assert.deepEqual(state.position, [2, 4, 6]);
    assert.deepEqual(state.scale, [2, 3, 3]);
    assert.ok(
        Math.abs(Math.hypot(...state.rotationQuaternion) - 1) < 1e-10,
    );
    assert.ok(Math.abs(Math.abs(state.rotationQuaternion[1]) - 1) < 1e-10);
    assert.ok(Math.abs(state.rotationQuaternion[3]) < 1e-10);

    const modelMatrix = transform.GetInterpolatedModelMatrix(0.5);
    assert.deepEqual(
        Array.from(modelMatrix.slice(12, 15)),
        [2, 4, 6],
    );
});

test("snaps interpolation to current values after a discontinuous change", () => {
    const transform = new Transform();
    transform.CapturePreviousState();
    transform.position = [10, 3, -2];
    transform.rotation = [0.25, 1, 0];
    transform.SnapInterpolationToCurrentState();

    const state = transform.GetInterpolatedState(0.25);

    assert.deepEqual(state.position, [10, 3, -2]);

    const interpolatedMatrix = Array.from(
        transform.GetInterpolatedModelMatrix(0.25),
    );
    const currentMatrix = Array.from(transform.GetModelMatrix());

    for (let index = 0; index < 16; index += 1) {
        assert.ok(
            Math.abs(interpolatedMatrix[index] - currentMatrix[index]) <
                1e-6,
        );
    }
});

test("rejects an interpolation alpha outside the frame interval", () => {
    const transform = new Transform();

    assert.throws(
        () => transform.GetInterpolatedState(1.1),
        /alpha must be between 0 and 1/,
    );
});
