import assert from "node:assert/strict";
import test from "node:test";
import { AngularVelocity } from "../../src/components/angular-velocity.js";
import { Camera } from "../../src/components/graphics/camera.js";
import { MeshRenderer } from "../../src/components/graphics/mesh-renderer.js";
import { Transform } from "../../src/components/transform.js";
import { CreateSceneComponentRegistry } from "../../src/components/register-scene-components.js";
import { AssetHandle } from "../../src/core/assets/asset-handle.js";
import { Scene } from "../../src/core/scene/scene.js";
import { CreateCubeMesh } from "../../src/graphics/primitives/cube.js";
import { Material } from "../../src/graphics/material.js";
import { EcsDocumentAdapter } from "../../src/serialization/adapters/ecs-document-adapter.js";

const entityIds = {
    camera: "10203040-aaaa-4aaa-8aaa-102030405060",
    first: "20304050-bbbb-4bbb-9bbb-203040506070",
    inactive: "30405060-cccc-4ccc-accc-304050607080",
};

function CreateLoadedHandle(assetId, asset) {
    const handle = new AssetHandle(assetId);
    handle._Replace(asset);
    return handle;
}

function CreateScene() {
    const scene = new Scene("adapter-scene");
    const cameraTransform = new Transform();
    cameraTransform.position = [0, 1, 4];
    scene.EntityManager.CreateEntity(entityIds.camera, "Main Camera");
    scene.EntityManager.AddComponent(entityIds.camera, Transform, cameraTransform);
    scene.EntityManager.AddComponent(entityIds.camera, Camera, new Camera());
    scene.SetActiveCameraEntity(entityIds.camera);

    scene.EntityManager.CreateEntity(entityIds.first, "Ground");
    scene.EntityManager.AddComponent(entityIds.first, Transform, new Transform());
    scene.EntityManager.AddComponent(
        entityIds.first,
        AngularVelocity,
        new AngularVelocity(0, 1, 0),
    );

    scene.EntityManager.CreateEntity(entityIds.inactive, "Hidden Ground");
    scene.EntityManager.AddComponent(
        entityIds.inactive,
        Transform,
        new Transform(),
    );
    scene.EntityManager.AddComponent(
        entityIds.inactive,
        AngularVelocity,
        new AngularVelocity(1, 0, 0),
    );
    scene.EntityManager.SetEntityActive(entityIds.inactive, false);
    scene.EntityManager.SetComponentEnabled(
        entityIds.inactive,
        AngularVelocity,
        false,
    );
    return scene;
}

test("serializes version 1 scene fields and named entities", () => {
    const scene = CreateScene();

    try {
        const document = new EcsDocumentAdapter(
            CreateSceneComponentRegistry(),
        ).Serialize(scene);

        assert.deepEqual(
            {
                format: document.format,
                version: document.version,
                name: document.name,
                activeCameraEntityId: document.activeCameraEntityId,
            },
            {
                format: "astral-scene",
                version: 1,
                name: "adapter-scene",
                activeCameraEntityId: entityIds.camera,
            },
        );
        assert.deepEqual(
            document.entities.map(({ id, name }) => ({ id, name })),
            [
                { id: entityIds.camera, name: "Main Camera" },
                { id: entityIds.first, name: "Ground" },
                { id: entityIds.inactive, name: "Hidden Ground" },
            ],
        );
        assert.equal(document.entities[0].components[0].version, 1);
    } finally {
        scene.Dispose();
    }
});

test("collects and sorts unique asset IDs from serialized components", () => {
    const scene = CreateScene();
    const mesh = CreateCubeMesh();
    const material = new Material({ bitmap: {} });
    const meshHandle = CreateLoadedHandle("builtin:cube", mesh);
    const materialHandle = CreateLoadedHandle("material:grass", material);
    const materialsBySlot = Object.fromEntries(
        mesh.Submeshes.map(({ materialSlot }) => [materialSlot, materialHandle]),
    );

    for (const entityId of [entityIds.first, entityIds.inactive]) {
        scene.EntityManager.AddComponent(
            entityId,
            MeshRenderer,
            new MeshRenderer(meshHandle, materialsBySlot),
        );
    }

    try {
        const document = new EcsDocumentAdapter(
            CreateSceneComponentRegistry(),
        ).Serialize(scene, {
            ResolveAssetId: (handle) => handle.AssetId,
        });

        assert.deepEqual(document.assets, ["builtin:cube", "material:grass"]);
        assert.equal(document.version, 1);
    } finally {
        scene.Dispose();
    }
});

test("writes inactive entity and disabled component state", () => {
    const scene = CreateScene();

    try {
        const document = new EcsDocumentAdapter(
            CreateSceneComponentRegistry(),
        ).Serialize(scene);
        const inactiveEntity = document.entities.find(
            ({ id }) => id === entityIds.inactive,
        );

        assert.equal(inactiveEntity.active, false);
        assert.equal(
            inactiveEntity.components.find(
                ({ typeId }) => typeId === "angularVelocity",
            ).enabled,
            false,
        );
    } finally {
        scene.Dispose();
    }
});

test("rejects a scene without an active camera", () => {
    const scene = new Scene("scene-without-camera");

    try {
        assert.throws(
            () => new EcsDocumentAdapter(CreateSceneComponentRegistry()).Serialize(scene),
            /valid active camera UUID/,
        );
    } finally {
        scene.Dispose();
    }
});

test("rejects an active camera view without Camera or Transform", () => {
    const scene = CreateScene();
    const transformOnlyId = "40506070-dddd-4ddd-8ddd-405060708090";
    const cameraOnlyId = "50607080-eeee-4eee-9eee-506070809001";
    scene.EntityManager.CreateEntity(transformOnlyId, "Transform Only");
    scene.EntityManager.AddComponent(transformOnlyId, Transform, new Transform());
    scene.EntityManager.CreateEntity(cameraOnlyId, "Camera Only");
    scene.EntityManager.AddComponent(cameraOnlyId, Camera, new Camera());
    const adapter = new EcsDocumentAdapter(CreateSceneComponentRegistry());

    try {
        const transformOnlyScene = new Proxy(scene, {
            get(target, property, receiver) {
                return property === "ActiveCameraEntityId"
                    ? transformOnlyId
                    : Reflect.get(target, property, receiver);
            },
        });
        const cameraOnlyScene = new Proxy(scene, {
            get(target, property, receiver) {
                return property === "ActiveCameraEntityId"
                    ? cameraOnlyId
                    : Reflect.get(target, property, receiver);
            },
        });

        assert.throws(
            () => adapter.Serialize(transformOnlyScene),
            /Active camera entity must have Camera and Transform components/,
        );
        assert.throws(
            () => adapter.Serialize(cameraOnlyScene),
            /Active camera entity must have Camera and Transform components/,
        );
    } finally {
        scene.Dispose();
    }
});

test("rejects a component registry without serialization", () => {
    assert.throws(
        () => new EcsDocumentAdapter({}),
        /requires a component serializer/,
    );
});
