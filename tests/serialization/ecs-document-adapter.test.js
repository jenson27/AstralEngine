import assert from "node:assert/strict";
import test from "node:test";
import { CreateCubeMesh } from "../../src/graphics/primitives/cube.js";
import { Camera } from "../../src/components/graphics/camera.js";
import { MeshRenderer } from "../../src/components/graphics/mesh-renderer.js";
import { Material } from "../../src/graphics/material.js";
import { AngularVelocity } from "../../src/components/angular-velocity.js";
import { Transform } from "../../src/components/transform.js";
import { AssetHandle } from "../../src/core/assets/asset-handle.js";
import { CreateSceneComponentRegistry } from "../../src/components/register-scene-components.js";
import { SceneLoader } from "../../src/core/scene-loader.js";
import { Scene } from "../../src/core/scene.js";
import { EcsDocumentAdapter } from "../../src/serialization/adapters/ecs-document-adapter.js";
import { JsonFormat } from "../../src/serialization/json-format.js";

function CreateLoadedHandle(assetId, asset) {
    const handle = new AssetHandle(assetId);
    handle._Replace(asset);
    return handle;
}

test("serializes and loads ECS data through registered component codecs", async () => {
    const componentRegistry = CreateSceneComponentRegistry();
    const mesh = CreateCubeMesh();
    const material = new Material({ bitmap: {} });
    const meshHandle = CreateLoadedHandle("builtin:cube", mesh);
    const materialHandle = CreateLoadedHandle(
        "material:grass",
        material,
    );
    const materialHandlesBySlot = Object.fromEntries(
        mesh.Submeshes.map(({ materialSlot }) => [
            materialSlot,
            materialHandle,
        ]),
    );
    const services = {
        ResolveMeshHandle(assetId) {
            assert.equal(assetId, "builtin:cube");
            return meshHandle;
        },
        ResolveMaterialHandle(assetId) {
            assert.equal(assetId, "material:grass");
            return materialHandle;
        },
    };
    const scene = new Scene("serializer-check");

    const cameraEntityId = scene.EntityManager.CreateEntity(3);
    const cameraTransform = new Transform();
    cameraTransform.position = [0, 1, 4];
    scene.EntityManager.AddComponent(
        cameraEntityId,
        Transform,
        cameraTransform,
    );
    scene.EntityManager.AddComponent(cameraEntityId, Camera, new Camera());
    scene.SetActiveCameraEntity(cameraEntityId);

    const meshEntityId = scene.EntityManager.CreateEntity(8);
    const meshTransform = new Transform();
    meshTransform.position = [2, 0, 0];
    scene.EntityManager.AddComponent(meshEntityId, Transform, meshTransform);
    scene.EntityManager.AddComponent(
        meshEntityId,
        AngularVelocity,
        new AngularVelocity(0, 1, 0),
    );
    scene.EntityManager.AddComponent(
        meshEntityId,
        MeshRenderer,
        new MeshRenderer(meshHandle, materialHandlesBySlot),
    );

    const adapter = new EcsDocumentAdapter(componentRegistry);
    const json = JsonFormat.Stringify(adapter.Serialize(scene, services));
    const document = JsonFormat.Parse(json);
    const acquiredAssetIds = [];

    assert.equal(document.format, "astral-scene");
    assert.equal(document.version, 2);
    assert.deepEqual(document.assets, ["builtin:cube", "material:grass"]);
    assert.deepEqual(
        document.entities.map((entity) => entity.id),
        [cameraEntityId, meshEntityId],
    );

    const loadedScene = await new SceneLoader(
        componentRegistry,
    ).LoadDataAsync(document, {
        assetScope: {
            Acquire(assetId) {
                acquiredAssetIds.push(assetId);
                return Promise.resolve();
            },
        },
        services,
    });
    assert.deepEqual(acquiredAssetIds, document.assets);
    const loadedTransform = loadedScene.EntityManager.GetComponent(
        meshEntityId,
        Transform,
    );
    const loadedAngularVelocity = loadedScene.EntityManager.GetComponent(
        meshEntityId,
        AngularVelocity,
    );
    const loadedMeshRenderer = loadedScene.EntityManager.GetComponent(
        meshEntityId,
        MeshRenderer,
    );

    assert.deepEqual(loadedTransform.position, [2, 0, 0]);
    assert.equal(loadedAngularVelocity.y, 1);
    assert.strictEqual(loadedMeshRenderer.mesh, mesh);

    for (const { materialSlot } of mesh.Submeshes) {
        assert.strictEqual(
            loadedMeshRenderer.GetMaterialForSlot(materialSlot),
            material,
        );
    }

    loadedScene.Dispose();
    scene.Dispose();
});

test("loads version 2 mesh renderers with a default material asset", async () => {
    const componentRegistry = CreateSceneComponentRegistry();
    const mesh = CreateCubeMesh();
    const material = new Material({ bitmap: {} });
    const meshHandle = CreateLoadedHandle("builtin:cube", mesh);
    const materialHandle = CreateLoadedHandle(
        "material:grass",
        material,
    );
    const document = {
        format: "astral-scene",
        version: 2,
        name: "default-material-check",
        assets: ["builtin:cube", "material:grass"],
        activeCameraEntityId: 1,
        entities: [
            {
                id: 1,
                components: [
                    {
                        typeId: "transform",
                        version: 1,
                        data: {
                            position: [0, 0, 3],
                            rotation: [0, 0, 0],
                            scale: [1, 1, 1],
                        },
                    },
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
                id: 2,
                components: [
                    {
                        typeId: "transform",
                        version: 1,
                        data: {
                            position: [0, 0, 0],
                            rotation: [0, 0, 0],
                            scale: [1, 1, 1],
                        },
                    },
                    {
                        typeId: "meshRenderer",
                        version: 2,
                        data: {
                            meshAssetId: "builtin:cube",
                            defaultMaterialAssetId: "material:grass",
                        },
                    },
                ],
            },
        ],
    };
    const scene = await new SceneLoader(componentRegistry).LoadDataAsync(
        document,
        {
            assetScope: {
                async Acquire() {},
            },
            services: {
                ResolveMeshHandle: () => meshHandle,
                ResolveMaterialHandle: () => materialHandle,
            },
        },
    );

    for (const { materialSlot } of mesh.Submeshes) {
        assert.strictEqual(
            scene.EntityManager
                .GetComponent(2, MeshRenderer)
                .GetMaterialForSlot(materialSlot),
            material,
        );
    }

    scene.Dispose();
});

test("continues to load version 1 component maps", () => {
    const componentRegistry = CreateSceneComponentRegistry();
    const legacyDocument = {
        format: "astral-scene",
        version: 1,
        name: "legacy-level",
        activeCameraEntityId: 1,
        entities: [
            {
                id: 1,
                components: {
                    transform: {
                        position: [0, 0, 3],
                        rotation: [0, 0, 0],
                        scale: [1, 1, 1],
                    },
                    camera: {
                        fieldOfView: Math.PI / 3,
                        nearPlane: 0.1,
                        farPlane: 100,
                    },
                },
            },
        ],
    };

    const scene = new SceneLoader(componentRegistry).LoadData(legacyDocument);
    const transform = scene.EntityManager.GetComponent(1, Transform);

    assert.equal(scene.Name, "legacy-level");
    assert.deepEqual(transform.position, [0, 0, 3]);

    scene.Dispose();
});
