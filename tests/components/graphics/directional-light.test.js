import assert from "node:assert/strict";
import test from "node:test";
import { CreateSceneComponentRegistry } from "../../../src/components/register-scene-components.js";
import { DirectionalLight } from "../../../src/components/graphics/directional-light.js";

test("serializes and restores version 1 directional light data", () => {
    const registry = CreateSceneComponentRegistry();
    const light = new DirectionalLight({
        direction: [0, 2, 0],
        color: [1, 0.5, 0.25],
        intensity: 4,
    });

    const record = registry.SerializeComponent(light);
    assert.deepEqual(record, {
        typeId: "directionalLight",
        version: 1,
        data: {
            direction: [0, 1, 0],
            color: [1, 0.5, 0.25],
            intensity: 4,
        },
    });

    const restored = registry.DeserializeComponent(record).component;
    assert.ok(restored instanceof DirectionalLight);
    assert.deepEqual(restored.Direction, [0, 1, 0]);
    assert.deepEqual(restored.Color, [1, 0.5, 0.25]);
    assert.equal(restored.Intensity, 4);
});

test("rejects zero light directions and negative intensities", () => {
    assert.throws(
        () => new DirectionalLight({ direction: [0, 0, 0] }),
        /direction cannot be zero/,
    );
    assert.throws(
        () => new DirectionalLight({ intensity: -1 }),
        /intensity must be non-negative/,
    );
});
