import assert from "node:assert/strict";
import test from "node:test";
import { Camera } from "../src/components/graphics/camera.js";
import { Parent } from "../src/components/parent.js";
import { Transform } from "../src/components/transform.js";
import { Scene } from "../src/core/scene/scene.js";
import { SystemPhase } from "../src/core/scene/system-scheduler.js";

class Marker {}

function AddCameraEntity(scene) {
    const entityId = scene.EntityManager.CreateEntity();
    scene.EntityManager.AddComponent(entityId, Transform, new Transform());
    scene.EntityManager.AddComponent(entityId, Camera, new Camera());
    return entityId;
}

function AddTransformEntity(scene) {
    const entityId = scene.EntityManager.CreateEntity();
    scene.EntityManager.AddComponent(entityId, Transform, new Transform());
    return entityId;
}

test("runs scene systems and disposes them in reverse order", () => {
    const scene = new Scene("lifecycle-test");
    const calls = [];
    const entityId = scene.EntityManager.CreateEntity();
    scene.EntityManager.AddComponent(entityId, Marker, new Marker());

    scene.AddSystem(SystemPhase.FixedUpdate, {
        Initialize(initializedScene) {
            assert.strictEqual(initializedScene, scene);
            calls.push("initialize:update");

            initializedScene.EntityManager.RegisterComponentRemovalHandler(
                Marker,
                ({ entityId: removedEntityId }) => {
                    calls.push(`remove:${removedEntityId}`);
                },
            );
        },

        FixedUpdate(updatedScene, context) {
            assert.strictEqual(updatedScene, scene);
            calls.push([
                "fixed-update",
                context.deltaTime,
                context.elapsedTime,
            ]);
        },

        Shutdown(shutdownScene) {
            assert.strictEqual(shutdownScene, scene);
            calls.push("shutdown:update");
        },
    });

    scene.AddSystem(SystemPhase.PrepareRender, {
        Initialize(initializedScene) {
            assert.strictEqual(initializedScene, scene);
            calls.push("initialize:render");
        },

        PrepareRender(renderScene, context) {
            assert.strictEqual(renderScene, scene);
            calls.push([
                "prepare-render",
                context.interpolationAlpha,
                context.aspectRatio,
            ]);
        },

        Shutdown(shutdownScene) {
            assert.strictEqual(shutdownScene, scene);
            calls.push("shutdown:render");
        },
    });

    scene.Initialize();
    scene.FixedUpdate(1 / 60, 2 / 60);
    scene.PrepareRender(0.5, 16 / 9);
    scene.Dispose();
    scene.Dispose();

    assert.deepEqual(calls, [
        "initialize:update",
        "initialize:render",
        ["fixed-update", 1 / 60, 2 / 60],
        ["prepare-render", 0.5, 16 / 9],
        `remove:${entityId}`,
        "shutdown:render",
        "shutdown:update",
    ]);
});

test("cleans up systems when initialization fails", () => {
    const scene = new Scene("failed-init-test");
    const calls = [];
    const initializationError = new Error("System initialization failed.");

    scene.AddSystem(SystemPhase.FixedUpdate, {
        Initialize() {
            calls.push("initialize:first");
        },

        FixedUpdate() {},

        Shutdown() {
            calls.push("shutdown:first");
        },
    });

    scene.AddSystem(SystemPhase.FixedUpdate, {
        Initialize() {
            calls.push("initialize:failing");
            throw initializationError;
        },

        FixedUpdate() {},

        Shutdown() {
            calls.push("shutdown:failing");
        },
    });

    scene.AddSystem(SystemPhase.PrepareRender, {
        Initialize() {
            calls.push("initialize:later");
        },

        PrepareRender() {},

        Shutdown() {
            calls.push("shutdown:later");
        },
    });

    assert.throws(
        () => scene.Initialize(),
        (error) => error === initializationError,
    );

    scene.Dispose();

    assert.deepEqual(calls, [
        "initialize:first",
        "initialize:failing",
        "shutdown:failing",
        "shutdown:first",
    ]);
    assert.throws(
        () => scene.FixedUpdate(1 / 60, 1 / 60),
        /Scene is not active/,
    );
});

test("rejects disposing a scene during system initialization", () => {
    const scene = new Scene("dispose-during-init-test");

    scene.AddSystem(SystemPhase.FixedUpdate, {
        Initialize(initializedScene) {
            initializedScene.Dispose();
        },

        FixedUpdate() {},
    });

    assert.throws(
        () => scene.Initialize(),
        /Cannot dispose a scene during initialization/,
    );

    scene.Dispose();
    assert.throws(() => scene.Initialize(), /only be initialized once/);
});

test("flushes queued ECS changes when a fixed update system throws", () => {
    const scene = new Scene("failed-fixed-update-test");
    const entityId = scene.EntityManager.CreateEntity();
    scene.EntityManager.AddComponent(entityId, Marker, new Marker());
    const removedEntityIds = [];

    scene.EntityManager.RegisterComponentRemovalHandler(
        Marker,
        ({ entityId: removedEntityId }) => removedEntityIds.push(removedEntityId),
    );

    scene.AddSystem(SystemPhase.FixedUpdate, {
        FixedUpdate(updatedScene) {
            updatedScene.CommandBuffer.DestroyEntity(entityId);
            throw new Error("Fixed update failed.");
        },
    });

    scene.Initialize();

    assert.throws(
        () => scene.FixedUpdate(1 / 60, 1 / 60),
        (error) =>
            error instanceof AggregateError &&
            error.message === "Scene fixed update failed: failed-fixed-update-test",
    );
    assert.deepEqual(scene.EntityManager.GetEntityIds(), []);
    assert.deepEqual(removedEntityIds, [entityId]);

    scene.Dispose();
});

test("protects the active camera until another camera is selected", () => {
    const scene = new Scene("camera-test");
    const firstCameraId = AddCameraEntity(scene);
    const secondCameraId = AddCameraEntity(scene);

    scene.SetActiveCameraEntity(firstCameraId);

    assert.throws(
        () => scene.EntityManager.RemoveComponent(firstCameraId, Camera),
        /Switch to another camera/,
    );
    assert.throws(
        () => scene.EntityManager.RemoveComponent(firstCameraId, Transform),
        /Switch to another camera/,
    );
    assert.throws(
        () => scene.EntityManager.DestroyEntity(firstCameraId),
        /Switch to another camera/,
    );

    scene.SetActiveCameraEntity(secondCameraId);

    assert.equal(
        scene.EntityManager.RemoveComponent(firstCameraId, Camera),
        true,
    );
    assert.equal(
        scene.EntityManager.RemoveComponent(firstCameraId, Transform),
        true,
    );

    scene.EntityManager.DestroyEntity(firstCameraId);
    scene.Dispose();
});

test("destroys a hierarchy from children to root at the fixed update boundary", () => {
    const scene = new Scene("hierarchy-destroy-test");
    const rootEntityId = scene.EntityManager.CreateEntity();
    const childEntityId = scene.EntityManager.CreateEntity();
    const grandchildEntityId = scene.EntityManager.CreateEntity();
    const destroyedEntityIds = [];

    for (const entityId of [
        rootEntityId,
        childEntityId,
        grandchildEntityId,
    ]) {
        scene.EntityManager.AddComponent(entityId, Marker, new Marker());
    }
    scene.EntityManager.AddComponent(
        childEntityId,
        Parent,
        new Parent(rootEntityId),
    );
    scene.EntityManager.AddComponent(
        grandchildEntityId,
        Parent,
        new Parent(childEntityId),
    );
    scene.EntityManager.RegisterComponentRemovalHandler(
        Marker,
        ({ entityId }) => destroyedEntityIds.push(entityId),
    );
    scene.Initialize();

    assert.equal(scene.DestroyEntity(rootEntityId), true);
    assert.deepEqual(scene.EntityManager.GetEntityIds(), [
        rootEntityId,
        childEntityId,
        grandchildEntityId,
    ]);

    scene.FixedUpdate(1 / 60, 1 / 60);

    assert.deepEqual(scene.EntityManager.GetEntityIds(), []);
    assert.deepEqual(destroyedEntityIds, [
        grandchildEntityId,
        childEntityId,
        rootEntityId,
    ]);
    scene.Dispose();
});

test("rejects direct deletion of a parent and hierarchy-wide clear", () => {
    const scene = new Scene("hierarchy-delete-guard-test");
    const parentEntityId = scene.EntityManager.CreateEntity();
    const childEntityId = scene.EntityManager.CreateEntity();
    scene.EntityManager.AddComponent(
        childEntityId,
        Parent,
        new Parent(parentEntityId),
    );
    scene.Initialize();

    assert.throws(
        () => scene.EntityManager.DestroyEntity(parentEntityId),
        /Use Scene.DestroyEntity\(\)/,
    );
    assert.throws(
        () => scene.EntityManager.DestroyAllEntities(),
        /parent relationships exist/,
    );
    scene.CommandBuffer.DestroyEntity(parentEntityId);
    assert.throws(
        () => scene.FixedUpdate(1 / 60, 1 / 60),
        (error) =>
            error instanceof AggregateError &&
            error.errors[0] instanceof AggregateError &&
            error.errors[0].errors[0].cause.message.includes(
                "Use Scene.DestroyEntity()",
            ),
    );
    assert.deepEqual(
        scene.EntityManager.GetEntityIds(),
        [parentEntityId, childEntityId],
    );
    scene.Dispose();
});

test("refuses to destroy a hierarchy that contains the active camera", () => {
    const scene = new Scene("hierarchy-camera-delete-test");
    const rootEntityId = scene.EntityManager.CreateEntity();
    const cameraEntityId = AddCameraEntity(scene);
    scene.EntityManager.AddComponent(
        cameraEntityId,
        Parent,
        new Parent(rootEntityId),
    );
    scene.SetActiveCameraEntity(cameraEntityId);
    scene.Initialize();

    assert.throws(
        () => scene.DestroyEntity(rootEntityId),
        /Switch to another camera/,
    );
    scene.FixedUpdate(1 / 60, 1 / 60);
    assert.deepEqual(
        scene.EntityManager.GetEntityIds(),
        [rootEntityId, cameraEntityId],
    );
    scene.Dispose();
});

test("queues parent changes until fixed update and supports detaching", () => {
    const scene = new Scene("set-parent-test");
    const firstParentId = AddTransformEntity(scene);
    const secondParentId = AddTransformEntity(scene);
    const childEntityId = AddTransformEntity(scene);
    scene.EntityManager.AddComponent(
        childEntityId,
        Parent,
        new Parent(firstParentId),
    );
    scene.Initialize();

    assert.equal(scene.SetParent(childEntityId, secondParentId), true);
    assert.equal(
        scene.EntityManager.GetComponent(childEntityId, Parent).ParentEntityId,
        firstParentId,
    );

    scene.FixedUpdate(1 / 60, 1 / 60);

    assert.equal(
        scene.EntityManager.GetComponent(childEntityId, Parent).ParentEntityId,
        secondParentId,
    );
    assert.equal(scene.SetParent(childEntityId, null), true);
    assert.equal(
        scene.EntityManager.GetComponent(childEntityId, Parent).ParentEntityId,
        secondParentId,
    );

    scene.FixedUpdate(1 / 60, 2 / 60);

    assert.equal(scene.EntityManager.HasComponent(childEntityId, Parent), false);
    scene.Dispose();
});

test("validates queued parent changes against the effective hierarchy", () => {
    const scene = new Scene("set-parent-cycle-test");
    const firstEntityId = AddTransformEntity(scene);
    const secondEntityId = AddTransformEntity(scene);
    scene.Initialize();

    assert.equal(scene.SetParent(firstEntityId, secondEntityId), true);
    assert.throws(
        () => scene.SetParent(secondEntityId, firstEntityId),
        /Parent hierarchy contains a cycle/,
    );
    assert.throws(
        () => scene.SetParent(firstEntityId, firstEntityId),
        /Parent hierarchy contains a cycle/,
    );

    scene.FixedUpdate(1 / 60, 1 / 60);

    assert.equal(
        scene.EntityManager.GetComponent(firstEntityId, Parent).ParentEntityId,
        secondEntityId,
    );
    assert.equal(scene.EntityManager.HasComponent(secondEntityId, Parent), false);
    scene.Dispose();
});

test("uses queued parent changes when cascading entity destruction", () => {
    const scene = new Scene("set-parent-destroy-order-test");
    const originalParentId = AddTransformEntity(scene);
    const newParentId = AddTransformEntity(scene);
    const childEntityId = AddTransformEntity(scene);
    scene.EntityManager.AddComponent(
        childEntityId,
        Parent,
        new Parent(originalParentId),
    );
    scene.Initialize();

    assert.equal(scene.SetParent(childEntityId, newParentId), true);
    assert.equal(scene.DestroyEntity(originalParentId), true);
    scene.FixedUpdate(1 / 60, 1 / 60);

    assert.deepEqual(
        scene.EntityManager.GetEntityIds(),
        [newParentId, childEntityId],
    );
    assert.equal(
        scene.EntityManager.GetComponent(childEntityId, Parent).ParentEntityId,
        newParentId,
    );
    scene.Dispose();
});

test("rejects parent changes for pending deletion and direct runtime mutations", () => {
    const scene = new Scene("set-parent-guard-test");
    const parentEntityId = AddTransformEntity(scene);
    const childEntityId = AddTransformEntity(scene);
    const otherEntityId = AddTransformEntity(scene);
    scene.EntityManager.AddComponent(
        childEntityId,
        Parent,
        new Parent(parentEntityId),
    );
    scene.Initialize();

    assert.throws(
        () =>
            scene.EntityManager.AddComponent(
                otherEntityId,
                Parent,
                new Parent(parentEntityId),
            ),
        /Use Scene.SetParent\(\)/,
    );
    assert.throws(
        () => scene.EntityManager.RemoveComponent(childEntityId, Parent),
        /Use Scene.SetParent\(\)/,
    );

    assert.equal(scene.DestroyEntity(parentEntityId), true);
    assert.throws(
        () => scene.SetParent(childEntityId, null),
        /queued for destruction/,
    );
    scene.FixedUpdate(1 / 60, 1 / 60);

    assert.deepEqual(scene.EntityManager.GetEntityIds(), [otherEntityId]);
    scene.Dispose();
});

test("protects Transform components used by parent relationships", () => {
    const scene = new Scene("transform-hierarchy-guard-test");
    const parentEntityId = AddTransformEntity(scene);
    const childEntityId = AddTransformEntity(scene);
    scene.EntityManager.AddComponent(
        childEntityId,
        Parent,
        new Parent(parentEntityId),
    );
    scene.Initialize();

    assert.throws(
        () => scene.EntityManager.RemoveComponent(childEntityId, Transform),
        /Detach or reparent it first/,
    );
    assert.throws(
        () => scene.EntityManager.RemoveComponent(parentEntityId, Transform),
        /Detach or reparent it first/,
    );

    scene.CommandBuffer.RemoveComponent(parentEntityId, Transform);
    assert.throws(
        () => scene.FixedUpdate(1 / 60, 1 / 60),
        (error) =>
            error instanceof AggregateError &&
            error.errors[0] instanceof AggregateError &&
            error.errors[0].errors[0].cause.message.includes(
                "Detach or reparent it first",
            ),
    );
    assert.equal(
        scene.EntityManager.HasComponent(parentEntityId, Transform),
        true,
    );

    scene.SetParent(childEntityId, null);
    scene.CommandBuffer.RemoveComponent(parentEntityId, Transform);
    scene.FixedUpdate(1 / 60, 2 / 60);

    assert.equal(
        scene.EntityManager.HasComponent(parentEntityId, Transform),
        false,
    );
    assert.equal(
        scene.EntityManager.RemoveComponent(childEntityId, Transform),
        true,
    );
    scene.Dispose();
});
