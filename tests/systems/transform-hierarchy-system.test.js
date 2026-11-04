import assert from "node:assert/strict";
import test from "node:test";
import { Parent } from "../../src/components/parent.js";
import { Transform } from "../../src/components/transform.js";
import { Scene } from "../../src/core/scene.js";
import { SystemPhase } from "../../src/core/system-scheduler.js";
import { TransformHierarchySystem } from "../../src/systems/transform-hierarchy-system.js";

test("composes interpolated parent and child world matrices", () => {
    const scene = new Scene("transform-hierarchy-test");
    const parentEntityId = scene.EntityManager.CreateEntity();
    const childEntityId = scene.EntityManager.CreateEntity();
    const parentTransform = new Transform();
    const childTransform = new Transform();

    parentTransform.CapturePreviousState();
    childTransform.CapturePreviousState();
    parentTransform.position[0] = 4;
    childTransform.position[0] = 2;

    scene.EntityManager.AddComponent(
        parentEntityId,
        Transform,
        parentTransform,
    );
    scene.EntityManager.AddComponent(
        childEntityId,
        Transform,
        childTransform,
    );
    scene.EntityManager.AddComponent(
        childEntityId,
        Parent,
        new Parent(parentEntityId),
    );
    scene.AddSystem(
        SystemPhase.PrepareRender,
        new TransformHierarchySystem(),
    );
    scene.Initialize();

    try {
        scene.PrepareRender(0.5, 1);

        assert.equal(parentTransform.WorldMatrix[12], 2);
        assert.equal(childTransform.WorldMatrix[12], 3);
        assert.deepEqual(parentTransform.position, [4, 0, 0]);
        assert.deepEqual(childTransform.position, [2, 0, 0]);
    } finally {
        scene.Dispose();
    }
});

test("reparenting preserves local transform and updates world transform", () => {
    const scene = new Scene("transform-reparent-test");
    const firstParentId = scene.EntityManager.CreateEntity();
    const secondParentId = scene.EntityManager.CreateEntity();
    const childEntityId = scene.EntityManager.CreateEntity();

    const firstParentTransform = new Transform();
    firstParentTransform.position[0] = 4;

    const secondParentTransform = new Transform();
    secondParentTransform.position[0] = 10;

    const childTransform = new Transform();
    childTransform.position = [2, 3, 4];
    childTransform.rotation = [0.2, 0.3, 0.4];
    childTransform.scale = [2, 3, 4];

    const localPosition = [...childTransform.position];
    const localRotation = [...childTransform.rotation];
    const localScale = [...childTransform.scale];

    scene.EntityManager.AddComponent(
        firstParentId,
        Transform,
        firstParentTransform,
    );
    scene.EntityManager.AddComponent(
        secondParentId,
        Transform,
        secondParentTransform,
    );
    scene.EntityManager.AddComponent(
        childEntityId,
        Transform,
        childTransform,
    );
    scene.EntityManager.AddComponent(
        childEntityId,
        Parent,
        new Parent(firstParentId),
    );
    scene.AddSystem(
        SystemPhase.PrepareRender,
        new TransformHierarchySystem(),
    );
    scene.Initialize();

    try {
        scene.PrepareRender(1, 1);
        assert.equal(childTransform.WorldMatrix[12], 6);

        assert.equal(scene.SetParent(childEntityId, secondParentId), true);
        scene.PrepareRender(1, 1);
        assert.equal(childTransform.WorldMatrix[12], 6);

        scene.FixedUpdate(1 / 60, 1 / 60);
        scene.PrepareRender(1, 1);

        assert.equal(
            scene.EntityManager.GetComponent(childEntityId, Parent)
                .ParentEntityId,
            secondParentId,
        );
        assert.equal(childTransform.WorldMatrix[12], 12);
        assert.deepEqual(childTransform.position, localPosition);
        assert.deepEqual(childTransform.rotation, localRotation);
        assert.deepEqual(childTransform.scale, localScale);
    } finally {
        scene.Dispose();
    }
});

test("rejects a cyclic runtime parent hierarchy", () => {
    const scene = new Scene("transform-hierarchy-cycle-test");
    const firstEntityId = scene.EntityManager.CreateEntity();
    const secondEntityId = scene.EntityManager.CreateEntity();

    scene.EntityManager.AddComponent(
        firstEntityId,
        Transform,
        new Transform(),
    );
    scene.EntityManager.AddComponent(
        secondEntityId,
        Transform,
        new Transform(),
    );
    scene.EntityManager.AddComponent(
        firstEntityId,
        Parent,
        new Parent(secondEntityId),
    );
    scene.EntityManager.AddComponent(
        secondEntityId,
        Parent,
        new Parent(firstEntityId),
    );
    scene.AddSystem(
        SystemPhase.PrepareRender,
        new TransformHierarchySystem(),
    );
    scene.Initialize();

    try {
        assert.throws(
            () => scene.PrepareRender(0.5, 1),
            /Parent hierarchy contains a cycle/,
        );
    } finally {
        scene.Dispose();
    }
});
