import assert from "node:assert/strict";
import test from "node:test";
import { Camera } from "../../src/components/graphics/camera.js";
import { MeshRenderer } from "../../src/components/graphics/mesh-renderer.js";
import { Transform } from "../../src/components/transform.js";
import { Parent } from "../../src/components/parent.js";
import { AssetHandle } from "../../src/core/assets/asset-handle.js";
import { Scene } from "../../src/core/scene/scene.js";
import { SystemPhase } from "../../src/core/scene/system-scheduler.js";
import { Material } from "../../src/graphics/material.js";
import { Mesh } from "../../src/graphics/mesh.js";
import { RenderSystem } from "../../src/systems/render-system.js";
import { TransformHierarchySystem } from "../../src/systems/transform-hierarchy-system.js";

test("renders a parented camera and mesh using interpolated world transforms", () => {
    const scene = new Scene("render-interpolation-test");
    const parentEntityId = scene.EntityManager.CreateEntity();
    const parentTransform = new Transform();
    parentTransform.CapturePreviousState();
    parentTransform.position[0] = 8;
    scene.EntityManager.AddComponent(
        parentEntityId,
        Transform,
        parentTransform,
    );

    const cameraEntityId = scene.EntityManager.CreateEntity();
    const cameraTransform = new Transform();
    cameraTransform.CapturePreviousState();

    scene.EntityManager.AddComponent(
        cameraEntityId,
        Transform,
        cameraTransform,
    );
    scene.EntityManager.AddComponent(cameraEntityId, Camera, new Camera());
    scene.EntityManager.AddComponent(
        cameraEntityId,
        Parent,
        new Parent(parentEntityId),
    );
    scene.SetActiveCameraEntity(cameraEntityId);

    const meshEntityId = scene.EntityManager.CreateEntity();
    const meshTransform = new Transform();
    meshTransform.CapturePreviousState();
    meshTransform.position[0] = 4;

    scene.EntityManager.AddComponent(meshEntityId, Transform, meshTransform);
    scene.EntityManager.AddComponent(
        meshEntityId,
        Parent,
        new Parent(parentEntityId),
    );

    const mesh = new Mesh(
        new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        new Float32Array([0, 0, 1, 0, 0, 1]),
    );
    const meshHandle = new AssetHandle("test:mesh");
    meshHandle._Replace(mesh);

    const materialHandle = new AssetHandle("test:material");
    materialHandle._Replace(new Material({ bitmap: {} }));

    scene.EntityManager.AddComponent(
        meshEntityId,
        MeshRenderer,
        new MeshRenderer(meshHandle, { default: materialHandle }),
    );

    let renderCall;
    const renderSystem = new RenderSystem({
        SetRenderItems(...args) {
            renderCall = args;
        },
    });
    scene.AddSystem(
        SystemPhase.PrepareRender,
        new TransformHierarchySystem(),
    );
    scene.AddSystem(SystemPhase.PrepareRender, renderSystem);
    scene.Initialize();

    try {
        scene.PrepareRender(0.25, 1);

        const [renderItems, viewMatrix, projectionMatrix] = renderCall;

        assert.equal(renderItems.length, 1);
        assert.equal(renderItems[0].modelMatrix[12], 3);
        assert.equal(viewMatrix[12], -2);
        assert.ok(projectionMatrix instanceof Float32Array);
    } finally {
        scene.Dispose();
    }
});
