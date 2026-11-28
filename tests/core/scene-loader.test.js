import assert from "node:assert/strict";
import test from "node:test";
import { MeshRenderer } from "../../src/components/graphics/mesh-renderer.js";
import { CreateSceneComponentRegistry } from "../../src/components/register-scene-components.js";
import { AssetHandle } from "../../src/core/assets/asset-handle.js";
import { SceneLoader } from "../../src/core/scene/scene-loader.js";
import { CreateCubeMesh } from "../../src/graphics/primitives/cube.js";
import { Material } from "../../src/graphics/material.js";

function CreateLoadedHandle(assetId, asset) {
    const handle = new AssetHandle(assetId);
    handle._Replace(asset);
    return handle;
}

function CreateDefaultMaterialDocument() {
    return {
        format: "astral-scene",
        version: 1,
        name: "default-material-check",
        assets: ["builtin:cube", "material:grass"],
        activeCameraEntityId: "10203040-aaaa-4aaa-8aaa-102030405060",
        entities: [
            {
                id: "10203040-aaaa-4aaa-8aaa-102030405060",
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
                id: "20304050-bbbb-4bbb-9bbb-203040506070",
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
                        version: 1,
                        data: {
                            meshAssetId: "builtin:cube",
                            defaultMaterialAssetId: "material:grass",
                        },
                    },
                ],
            },
        ],
    };
}

test("loads version 1 mesh renderers with a default material asset", async () => {
    const componentRegistry = CreateSceneComponentRegistry();
    const mesh = CreateCubeMesh();
    const material = new Material({ bitmap: {} });
    const meshHandle = CreateLoadedHandle("builtin:cube", mesh);
    const materialHandle = CreateLoadedHandle("material:grass", material);
    const scene = await new SceneLoader(componentRegistry).LoadDataAsync(
        CreateDefaultMaterialDocument(),
        {
            assetScope: { async Acquire() {} },
            componentServices: {
                ResolveAssetHandle: (assetId, expectedTypeId) => {
                    if (expectedTypeId === "mesh") {
                        return meshHandle;
                    }
                    if (expectedTypeId === "material") {
                        return materialHandle;
                    }
                    throw new Error(`Unexpected asset type: ${expectedTypeId}`);
                },
            },
        },
    );

    try {
        const [meshEntityId] = [...scene.EntityManager.Query(MeshRenderer)];
        const meshRenderer = scene.EntityManager.GetComponent(
            meshEntityId,
            MeshRenderer,
        );

        for (const { materialSlot } of mesh.Submeshes) {
            assert.strictEqual(
                meshRenderer.GetMaterialForSlot(materialSlot),
                material,
            );
        }
    } finally {
        scene.Dispose();
    }
});

test("rejects the legacy object-shaped version 1 component layout", () => {
    const document = {
        format: "astral-scene",
        version: 1,
        name: "old-level",
        activeCameraEntityId: "10203040-aaaa-4aaa-8aaa-102030405060",
        entities: [
            {
                id: "10203040-aaaa-4aaa-8aaa-102030405060",
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

    assert.throws(
        () => new SceneLoader(CreateSceneComponentRegistry()).LoadData(document),
        /Scene entity components must be an array of typed records\./,
    );
});

test("passes the scene load abort signal to its fetcher", async () => {
    const controller = new AbortController();
    let receivedSignal = null;
    const loader = new SceneLoader(
        CreateSceneComponentRegistry(),
        async (_url, options) => {
            receivedSignal = options.signal;
            throw new Error("Request stopped.");
        },
    );

    await assert.rejects(
        loader.Load("/scenes/test.json", { signal: controller.signal }),
        /Scene load failed/,
    );

    assert.strictEqual(receivedSignal, controller.signal);
});
