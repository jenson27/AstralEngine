import assert from "node:assert/strict";
import test from "node:test";
import { BuildSnapshotComparisonModel } from "../../src/editor/panels/diagnostics/snapshot-comparison-model.js";

const comparison = {
    deltaBytes: 64,
    addedBytes: 128,
    releasedBytes: 64,
    ownerChanges: {
        RenderSystem: {
            beforeBytes: 64,
            afterBytes: 0,
            deltaBytes: -64,
        },
        PhysicsSystem: {
            beforeBytes: 0,
            afterBytes: 128,
            deltaBytes: 128,
        },
    },
    added: [
        {
            resourceId: 2,
            label: "Physics buffer",
            owner: "PhysicsSystem",
            bytes: 128,
        },
    ],
    released: [
        {
            resourceId: 1,
            label: "Renderer buffer",
            owner: "RenderSystem",
            bytes: 64,
        },
    ],
};

test("filters snapshot summary and resources by owner", () => {
    const model = BuildSnapshotComparisonModel(
        comparison,
        "PhysicsSystem",
    );

    assert.equal(model.ownerLabel, "PhysicsSystem");
    assert.equal(model.deltaBytes, 128);
    assert.equal(model.addedBytes, 128);
    assert.equal(model.releasedBytes, 0);
    assert.deepEqual(
        model.ownerChanges.map(({ owner }) => owner),
        ["PhysicsSystem"],
    );
    assert.deepEqual(
        model.added.map(({ label }) => label),
        ["Physics buffer"],
    );
    assert.deepEqual(model.released, []);
});

test("keeps global totals and all resources for the all-owner view", () => {
    const model = BuildSnapshotComparisonModel(comparison, "");

    assert.equal(model.ownerLabel, "All owners");
    assert.equal(model.deltaBytes, 64);
    assert.equal(model.addedBytes, 128);
    assert.equal(model.releasedBytes, 64);
    assert.deepEqual(
        model.ownerChanges.map(({ owner }) => owner),
        ["PhysicsSystem", "RenderSystem"],
    );
    assert.equal(model.added.length, 1);
    assert.equal(model.released.length, 1);
});
