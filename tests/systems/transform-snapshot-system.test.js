import assert from "node:assert/strict";
import test from "node:test";
import { Transform } from "../../src/components/transform.js";
import { Scene } from "../../src/core/scene/scene.js";
import { SystemPhase } from "../../src/core/scene/system-scheduler.js";
import { TransformSnapshotSystem } from "../../src/systems/transform-snapshot-system.js";

test("captures transforms before other fixed-update systems change them", () => {
    const scene = new Scene("transform-snapshot-test");
    const entityId = scene.EntityManager.CreateEntity();
    const transform = new Transform();
    scene.EntityManager.AddComponent(entityId, Transform, transform);

    scene.AddSystem(
        SystemPhase.FixedUpdate,
        new TransformSnapshotSystem(),
    );
    scene.AddSystem(SystemPhase.FixedUpdate, {
        FixedUpdate() {
            transform.position[0] = 6;
        },
    });
    scene.Initialize();

    try {
        scene.FixedUpdate(1 / 60, 1 / 60);

        assert.equal(transform.GetInterpolatedState(0).position[0], 0);
        assert.equal(transform.GetInterpolatedState(1).position[0], 6);
    } finally {
        scene.Dispose();
    }
});
