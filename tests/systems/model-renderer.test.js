import assert from "node:assert/strict";
import test from "node:test";
import { Camera } from "../../src/components/graphics/camera.js";
import { ModelRenderer } from "../../src/components/graphics/model-renderer.js";
import { Transform } from "../../src/components/transform.js";
import { AssetHandle } from "../../src/core/assets/asset-handle.js";
import { Scene } from "../../src/core/scene/scene.js";
import { SystemPhase } from "../../src/core/scene/system-scheduler.js";
import { CreateSceneComponentRegistry } from "../../src/components/register-scene-components.js";
import { Profiler } from "../../src/diagnostics/profiling/profiler.js";
import { Material } from "../../src/graphics/material.js";
import { Mesh } from "../../src/graphics/mesh.js";
import { ModelAsset } from "../../src/graphics/model-asset.js";
import { RenderSystem } from "../../src/systems/render-system.js";
import { TransformHierarchySystem } from "../../src/systems/transform-hierarchy-system.js";

function CreateModelHandle(assetId = "model:test") {
    const mesh = new Mesh(
        new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        new Float32Array(6),
    );
    const modelHandle = new AssetHandle(assetId);
    modelHandle._Replace(new ModelAsset([
        {
            mesh,
            material: new Material(null),
            transform: new Float32Array([
                1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                0, 0, 0, 1,
            ]),
        },
    ]));
    return modelHandle;
}

test("serializes and restores a model renderer with version 1 data", () => {
    const registry = CreateSceneComponentRegistry();
    const modelHandle = CreateModelHandle();
    const component = new ModelRenderer(modelHandle);

    const record = registry.SerializeComponent(component);
    assert.deepEqual(record, {
        typeId: "modelRenderer",
        version: 1,
        data: { modelAssetId: "model:test" },
    });

    const restored = registry.DeserializeComponent(record, {
        ResolveModelHandle(assetId) {
            assert.equal(assetId, "model:test");
            return modelHandle;
        },
    });
    assert.ok(restored.component instanceof ModelRenderer);
    assert.strictEqual(restored.component.ModelHandle, modelHandle);
});

test("prepares model primitives with the entity world transform", () => {
    const scene = new Scene("model-renderer-test");
    const cameraEntityId = scene.EntityManager.CreateEntity();
    scene.EntityManager.AddComponent(cameraEntityId, Transform, new Transform());
    scene.EntityManager.AddComponent(cameraEntityId, Camera, new Camera());
    scene.SetActiveCameraEntity(cameraEntityId);

    const modelEntityId = scene.EntityManager.CreateEntity();
    const transform = new Transform();
    transform.position[0] = 4;
    transform.position[1] = 2;
    scene.EntityManager.AddComponent(modelEntityId, Transform, transform);
    scene.EntityManager.AddComponent(
        modelEntityId,
        ModelRenderer,
        new ModelRenderer(CreateModelHandle()),
    );

    let renderItems;
    scene.AddSystem(
        SystemPhase.PrepareRender,
        new TransformHierarchySystem(),
    );
    scene.AddSystem(
        SystemPhase.PrepareRender,
        new RenderSystem({
            SetRenderItems(items) {
                renderItems = items;
            },
        }),
    );
    scene.Initialize();
    const profiler = new Profiler();
    profiler.BeginFrame(1);

    try {
        scene.PrepareRender(0, 1, { profiler });
        assert.equal(renderItems.length, 1);
        assert.ok(renderItems[0].mesh instanceof Mesh);
        assert.ok(
            renderItems[0].materialsBySlot.default instanceof Material,
        );
        assert.equal(renderItems[0].modelMatrix[12], 4);
        assert.equal(renderItems[0].modelMatrix[13], 2);

        const profileFrame = profiler.EndFrame();
        const modelScope = profileFrame.scopes.find(
            ({ name }) => name === "ModelRenderer:model:test",
        );
        const renderSystemScope = profileFrame.scopes.find(
            ({ name }) => name === "prepare-render:RenderSystem",
        );
        assert.equal(modelScope.category, "asset");
        assert.equal(
            modelScope.parentScopeIndex,
            profileFrame.scopes.indexOf(renderSystemScope),
        );
    } finally {
        scene.Dispose();
    }
});
