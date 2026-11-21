import assert from "node:assert/strict";
import test from "node:test";
import { AngularVelocity } from "../../src/components/angular-velocity.js";
import { Parent } from "../../src/components/parent.js";
import { Transform } from "../../src/components/transform.js";
import { CreateSceneComponentRegistry } from "../../src/components/register-scene-components.js";
import { SceneLoader } from "../../src/core/scene-loader.js";
import { EditorCommandHistory } from "../../src/editor/editor-command-history.js";
import { EditorSelection } from "../../src/editor/editor-selection.js";
import {
    CreateEditorComponentAuthoringCatalog,
    EditorComponentAuthoringCatalog,
} from "../../src/editor/component-authoring-catalog.js";
import { EditorSceneAuthoringController } from "../../src/editor/scene-authoring-controller.js";

const CAMERA_ENTITY_ID = "10203040-aaaa-4aaa-8aaa-102030405060";
const ROOT_ENTITY_ID = "20304050-bbbb-4bbb-9bbb-203040506070";
const CHILD_ENTITY_ID = "30405060-cccc-4ccc-accc-304050607080";
const EMPTY_ENTITY_ID = "40506070-dddd-4ddd-8ddd-405060708090";

function CreateTransformRecord() {
    return {
        typeId: "transform",
        version: 1,
        data: {
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
        },
    };
}

function CreateSceneDocument() {
    return {
        format: "astral-scene",
        version: 1,
        name: "authoring-test",
        assets: [],
        activeCameraEntityId: CAMERA_ENTITY_ID,
        entities: [
            {
                id: CAMERA_ENTITY_ID,
                name: "Main Camera",
                components: [
                    CreateTransformRecord(),
                    {
                        typeId: "camera",
                        version: 1,
                        data: {
                            fieldOfView: Math.PI / 3,
                            nearPlane: 0.1,
                            farPlane: 100,
                        },
                    },
                ],
            },
            {
                id: ROOT_ENTITY_ID,
                name: "Root",
                active: false,
                components: [
                    CreateTransformRecord(),
                    {
                        typeId: "angularVelocity",
                        version: 1,
                        enabled: false,
                        data: { x: 1, y: 2, z: 3 },
                    },
                ],
            },
            {
                id: CHILD_ENTITY_ID,
                name: "Child",
                components: [
                    CreateTransformRecord(),
                    {
                        typeId: "parent",
                        version: 1,
                        data: { parentEntityId: ROOT_ENTITY_ID },
                    },
                ],
            },
            {
                id: EMPTY_ENTITY_ID,
                name: "Empty",
                components: [],
            },
        ],
    };
}

function CreateHarness(context, componentCatalog = CreateEditorComponentAuthoringCatalog()) {
    const scene = new SceneLoader(
        CreateSceneComponentRegistry(),
    ).LoadData(CreateSceneDocument());
    const history = new EditorCommandHistory();
    const selection = new EditorSelection();
    const sceneManager = {
        ActiveScene: scene,
        AcquireAssetHandle: async () => {
            throw new Error("Asset acquisition is not used by this test.");
        },
    };
    const controller = new EditorSceneAuthoringController({
        sceneManager,
        selection,
        history,
        componentCatalog,
    });

    selection.Select(scene, ROOT_ENTITY_ID);
    context.after(() => scene.Dispose());

    return { scene, history, selection, sceneManager, controller };
}

function CreateDeferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

test("creates entities and supports undo and redo", async (context) => {
    const { scene, history, selection, controller } = CreateHarness(context);
    const entityId = controller.CreateEntity();

    assert.equal(scene.EntityManager.GetEntityName(entityId), "Entity");
    assert.ok(scene.EntityManager.GetComponent(entityId, Transform));
    assert.equal(selection.Current.entityId, entityId);

    await history.Undo();
    assert.equal(scene.EntityManager.GetEntityIds().includes(entityId), false);
    assert.equal(selection.Current, null);

    await history.Redo();
    assert.equal(scene.EntityManager.GetEntityName(entityId), "Entity");
    assert.ok(scene.EntityManager.GetComponent(entityId, Transform));
    assert.equal(selection.Current.entityId, entityId);
});

test("adds and removes components with validation and undo history", async (context) => {
    const { scene, history, selection, controller } = CreateHarness(context);
    const entityManager = scene.EntityManager;
    selection.Select(scene, CHILD_ENTITY_ID);

    await controller.AddComponent(scene, CHILD_ENTITY_ID, "angularVelocity");
    const component = entityManager.GetComponent(
        CHILD_ENTITY_ID,
        AngularVelocity,
    );
    assert.ok(component);

    await assert.rejects(
        controller.AddComponent(scene, CHILD_ENTITY_ID, "angularVelocity"),
        /already on this entity/,
    );
    await assert.rejects(
        controller.AddComponent(scene, EMPTY_ENTITY_ID, "angularVelocity"),
        /requires additional components/,
    );

    await history.Undo();
    assert.equal(entityManager.HasComponent(CHILD_ENTITY_ID, AngularVelocity), false);
    await history.Redo();
    assert.equal(
        entityManager.GetComponent(CHILD_ENTITY_ID, AngularVelocity),
        component,
    );

    controller.RemoveComponent(scene, CHILD_ENTITY_ID, "angularVelocity");
    assert.equal(entityManager.HasComponent(CHILD_ENTITY_ID, AngularVelocity), false);
    await history.Undo();
    assert.equal(
        entityManager.GetComponent(CHILD_ENTITY_ID, AngularVelocity),
        component,
    );
    await history.Redo();
    assert.equal(entityManager.HasComponent(CHILD_ENTITY_ID, AngularVelocity), false);
});

test("deletes a subtree and restores its hierarchy and component state", async (context) => {
    const { scene, history, selection, controller } = CreateHarness(context);
    const entityManager = scene.EntityManager;
    const angularVelocity = entityManager.GetComponent(
        ROOT_ENTITY_ID,
        AngularVelocity,
    );

    selection.Select(scene, CHILD_ENTITY_ID);
    controller.DeleteEntity(scene, ROOT_ENTITY_ID);
    assert.equal(selection.Current, null);

    scene.FixedUpdate(1 / 60, 1 / 60);
    assert.equal(entityManager.GetEntityIds().includes(ROOT_ENTITY_ID), false);
    assert.equal(entityManager.GetEntityIds().includes(CHILD_ENTITY_ID), false);

    await history.Undo();
    scene.FixedUpdate(1 / 60, 2 / 60);

    assert.equal(entityManager.GetEntityName(ROOT_ENTITY_ID), "Root");
    assert.equal(entityManager.GetEntityName(CHILD_ENTITY_ID), "Child");
    assert.equal(entityManager.IsEntityActive(ROOT_ENTITY_ID), false);
    assert.equal(entityManager.IsComponentEnabled(ROOT_ENTITY_ID, AngularVelocity), false);
    assert.equal(
        entityManager.GetComponent(ROOT_ENTITY_ID, AngularVelocity),
        angularVelocity,
    );
    assert.equal(
        entityManager.GetComponent(CHILD_ENTITY_ID, Parent).ParentEntityId,
        ROOT_ENTITY_ID,
    );
    assert.equal(selection.Current.entityId, ROOT_ENTITY_ID);

    await history.Redo();
    scene.FixedUpdate(1 / 60, 3 / 60);
    assert.equal(entityManager.GetEntityIds().includes(ROOT_ENTITY_ID), false);
    assert.equal(entityManager.GetEntityIds().includes(CHILD_ENTITY_ID), false);
});

test("rejects deletion of the active camera", (context) => {
    const { scene, history, controller } = CreateHarness(context);

    assert.throws(
        () => controller.DeleteEntity(scene, CAMERA_ENTITY_ID),
        /Switch to another camera/,
    );
    assert.equal(
        scene.EntityManager.GetEntityIds().includes(CAMERA_ENTITY_ID),
        true,
    );
    assert.equal(history.CanUndo, false);
});

test("guards pending component creation and rejects stale async targets", async (context) => {
    class DeferredComponent {}

    let deferred = CreateDeferred();
    const componentCatalog = new EditorComponentAuthoringCatalog();
    componentCatalog.Register("deferred", DeferredComponent, {
        title: "Deferred",
        create: () => deferred.promise,
        requiredComponentTypes: [Transform],
    });
    const harness = CreateHarness(context, componentCatalog);
    const { scene, history, selection, sceneManager, controller } = harness;

    const pendingAdd = controller.AddComponent(
        scene,
        ROOT_ENTITY_ID,
        "deferred",
    );
    assert.equal(controller.IsBusy, true);
    assert.throws(() => controller.CreateEntity(), /current editor action/);
    assert.throws(
        () => controller.DeleteEntity(scene, ROOT_ENTITY_ID),
        /current editor action/,
    );

    deferred.resolve(new DeferredComponent());
    await pendingAdd;
    assert.equal(controller.IsBusy, false);

    await history.Undo();
    assert.equal(
        scene.EntityManager.HasComponent(ROOT_ENTITY_ID, DeferredComponent),
        false,
    );

    deferred = CreateDeferred();
    const staleSelectionAdd = controller.AddComponent(
        scene,
        ROOT_ENTITY_ID,
        "deferred",
    );
    selection.Select(scene, CHILD_ENTITY_ID);
    deferred.resolve(new DeferredComponent());
    await assert.rejects(staleSelectionAdd, /selection changed/i);
    assert.equal(
        scene.EntityManager.HasComponent(ROOT_ENTITY_ID, DeferredComponent),
        false,
    );

    selection.Select(scene, ROOT_ENTITY_ID);
    deferred = CreateDeferred();
    const staleSceneAdd = controller.AddComponent(
        scene,
        ROOT_ENTITY_ID,
        "deferred",
    );
    sceneManager.ActiveScene = null;
    deferred.resolve(new DeferredComponent());
    await assert.rejects(staleSceneAdd, /scene or selection changed/i);

    sceneManager.ActiveScene = scene;
    assert.equal(controller.IsBusy, false);
    assert.equal(
        scene.EntityManager.HasComponent(ROOT_ENTITY_ID, DeferredComponent),
        false,
    );
});
