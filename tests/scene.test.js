import assert from "node:assert/strict";
import test from "node:test";
import { Camera } from "../src/components/graphics/camera.js";
import { Transform } from "../src/components/transform.js";
import { Scene } from "../src/core/scene.js";
import { SystemPhase } from "../src/core/system-scheduler.js";

class Marker {}

function AddCameraEntity(scene) {
    const entityId = scene.EntityManager.CreateEntity();
    scene.EntityManager.AddComponent(entityId, Transform, new Transform());
    scene.EntityManager.AddComponent(entityId, Camera, new Camera());
    return entityId;
}

test("runs scene systems and disposes them in reverse order", () => {
    const scene = new Scene("lifecycle-test");
    const calls = [];
    const services = { marker: true };
    const entityId = scene.EntityManager.CreateEntity();
    scene.EntityManager.AddComponent(entityId, Marker, new Marker());

    scene.AddSystem(SystemPhase.FixedUpdate, {
        Initialize(initializedScene, passedServices) {
            assert.strictEqual(initializedScene, scene);
            assert.strictEqual(passedServices, services);
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

    scene.Initialize(services);
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
