import assert from "node:assert/strict";
import test from "node:test";
import { Camera } from "../../src/components/graphics/camera.js";
import { DirectionalLight } from "../../src/components/graphics/directional-light.js";
import { MeshRenderer } from "../../src/components/graphics/mesh-renderer.js";
import { ModelRenderer } from "../../src/components/graphics/model-renderer.js";
import { SpriteAnimator } from "../../src/components/graphics/sprite-animator.js";
import { SpriteRenderer } from "../../src/components/graphics/sprite-renderer.js";
import { Transform } from "../../src/components/transform.js";
import { AssetHandle } from "../../src/core/assets/asset-handle.js";
import { Scene } from "../../src/core/scene/scene.js";
import { SystemPhase } from "../../src/core/scene/system-scheduler.js";
import { Material } from "../../src/graphics/material.js";
import { Mesh } from "../../src/graphics/mesh.js";
import { ModelAsset } from "../../src/graphics/model-asset.js";
import { SpriteAnimationAsset } from "../../src/graphics/sprite-animation-asset.js";
import { RenderSystem } from "../../src/systems/render-system.js";
import { TransformHierarchySystem } from "../../src/systems/transform-hierarchy-system.js";

const identityMatrix = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]);

function CreateLoadedHandle(assetId, asset) {
    const handle = new AssetHandle(assetId);
    handle._Replace(asset);
    return handle;
}

function CreateMesh() {
    return new Mesh(
        new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        new Float32Array([0, 0, 1, 0, 0, 1]),
    );
}

function CreateSpriteAnimation() {
    return new SpriteAnimationAsset(
        {
            version: 1,
            textureAssetId: "texture:sprite-sheet",
            grid: { frameWidth: 1, frameHeight: 1, columns: 4 },
            pixelsPerUnit: 1,
            pivot: [0.5, 0.5],
            defaultClip: "idle",
            eventToClip: {},
            clips: {
                idle: { frames: [{ frame: 2, durationMs: 100 }] },
            },
        },
        { bitmap: {}, width: 4, height: 1 },
    );
}

function CreateRenderFixture(name = "render-system-test") {
    const calls = [];
    const renderer = {
        SetRenderItems(...args) {
            calls.push(args);
        },
    };
    const scene = new Scene(name);
    const cameraEntityId = scene.EntityManager.CreateEntity(
        "00000000-0000-4000-8000-000000000001",
        "Camera",
    );
    scene.EntityManager.AddComponent(cameraEntityId, Transform, new Transform());
    scene.EntityManager.AddComponent(cameraEntityId, Camera, new Camera());
    scene.SetActiveCameraEntity(cameraEntityId);
    scene.AddSystem(
        SystemPhase.PrepareRender,
        new TransformHierarchySystem(),
    );
    scene.AddSystem(SystemPhase.PrepareRender, new RenderSystem(renderer));
    scene.Initialize();
    return { calls, cameraEntityId, scene };
}

function AddSprite(scene, entityId, { depth, renderOrder = 0, billboardMode } = {}) {
    const animator = new SpriteAnimator(
        CreateLoadedHandle("animation:sprite", CreateSpriteAnimation()),
    );
    const transform = new Transform();
    transform.position[2] = -depth;
    scene.EntityManager.CreateEntity(entityId, `Sprite ${entityId}`);
    scene.EntityManager.AddComponent(entityId, Transform, transform);
    scene.EntityManager.AddComponent(
        entityId,
        SpriteRenderer,
        new SpriteRenderer({ renderOrder, billboardMode }),
    );
    scene.EntityManager.AddComponent(entityId, SpriteAnimator, animator);
    return animator;
}

test("builds mesh render items from interpolated world transforms", () => {
    const { calls, scene } = CreateRenderFixture();
    const meshEntityId = scene.EntityManager.CreateEntity(
        "00000000-0000-4000-8000-000000000011",
    );
    const meshTransform = new Transform();
    meshTransform.position[0] = 4;
    meshTransform.CapturePreviousState();
    meshTransform.position[0] = 8;
    scene.EntityManager.AddComponent(meshEntityId, Transform, meshTransform);

    const mesh = CreateMesh();
    const material = new Material({ bitmap: {} });
    const meshHandle = CreateLoadedHandle("mesh:test", mesh);
    const materialHandle = CreateLoadedHandle("material:test", material);
    scene.EntityManager.AddComponent(
        meshEntityId,
        MeshRenderer,
        new MeshRenderer(meshHandle, { default: materialHandle }),
    );

    try {
        scene.PrepareRender(0.25, 1.5);

        const [renderItems, viewMatrix, projectionMatrix] = calls[0];
        assert.equal(renderItems.length, 1);
        assert.strictEqual(renderItems[0].mesh, mesh);
        assert.strictEqual(renderItems[0].materialsBySlot.default, material);
        assert.equal(renderItems[0].modelMatrix[12], 5);
        assert.ok(viewMatrix instanceof Float32Array);
        assert.ok(projectionMatrix instanceof Float32Array);
        assert.equal(projectionMatrix.length, 16);
    } finally {
        scene.Dispose();
    }
});

test("composes entity and primitive transforms for model render items", () => {
    const { calls, scene } = CreateRenderFixture();
    const entityId = scene.EntityManager.CreateEntity(
        "00000000-0000-4000-8000-000000000020",
    );
    const transform = new Transform();
    transform.position[0] = 4;
    scene.EntityManager.AddComponent(entityId, Transform, transform);
    const mesh = CreateMesh();
    const material = new Material({ bitmap: {} });
    const primitiveTransform = identityMatrix.slice();
    primitiveTransform[12] = 2;
    const modelHandle = CreateLoadedHandle(
        "model:test",
        new ModelAsset([{ mesh, material, transform: primitiveTransform }]),
    );
    scene.EntityManager.AddComponent(
        entityId,
        ModelRenderer,
        new ModelRenderer(modelHandle),
    );

    try {
        scene.PrepareRender(1, 1);

        const [renderItems] = calls[0];
        assert.equal(renderItems.length, 1);
        assert.strictEqual(renderItems[0].mesh, mesh);
        assert.strictEqual(renderItems[0].materialsBySlot.default, material);
        assert.equal(renderItems[0].modelMatrix[12], 6);
    } finally {
        scene.Dispose();
    }
});

test("sorts sprite billboards by depth, render order, and entity ID", () => {
    const { calls, scene } = CreateRenderFixture();
    const ids = {
        far: "00000000-0000-4000-8000-000000000030",
        order: "00000000-0000-4000-8000-000000000031",
        tieLater: "00000000-0000-4000-8000-000000000033",
        tieEarlier: "00000000-0000-4000-8000-000000000032",
        near: "00000000-0000-4000-8000-000000000034",
    };
    AddSprite(scene, ids.near, { depth: 1 });
    AddSprite(scene, ids.tieLater, { depth: 4, renderOrder: 2 });
    AddSprite(scene, ids.far, { depth: 7 });
    AddSprite(scene, ids.tieEarlier, { depth: 4, renderOrder: 2 });
    AddSprite(scene, ids.order, { depth: 4, renderOrder: 1 });

    try {
        scene.PrepareRender(1, 1);

        const spriteItems = calls[0][4];
        assert.deepEqual(
            spriteItems.map(({ entityId }) => entityId),
            [ids.far, ids.order, ids.tieEarlier, ids.tieLater, ids.near],
        );
        assert.deepEqual(spriteItems[0].uvRect, [0.5, 0, 0.25, 1]);
        assert.equal(spriteItems[0].depth, 7);
        assert.deepEqual(spriteItems[0].right, [1, 0, 0]);
        assert.deepEqual(spriteItems[0].up, [0, 1, 0]);
    } finally {
        scene.Dispose();
    }
});

test("forwards a directional light and uses default lighting when disabled", () => {
    const { calls, scene } = CreateRenderFixture();
    const lightEntityId = scene.EntityManager.CreateEntity(
        "00000000-0000-4000-8000-000000000040",
    );
    const light = new DirectionalLight({
        direction: [1, 2, 3],
        color: [0.25, 0.5, 0.75],
        intensity: 2,
    });
    scene.EntityManager.AddComponent(lightEntityId, DirectionalLight, light);

    try {
        scene.PrepareRender(1, 1);
        assert.deepEqual(calls[0][3], {
            direction: light.Direction,
            color: light.Color,
            intensity: light.Intensity,
            cameraPosition: [0, 0, 0],
        });

        scene.SetComponentEnabled(lightEntityId, DirectionalLight, false);
        scene.PrepareRender(1, 1);
        assert.deepEqual(calls[1][3], {
            direction: [0.4, 0.8, 0.45],
            color: [1, 1, 1],
            intensity: 3,
            cameraPosition: [0, 0, 0],
        });
    } finally {
        scene.Dispose();
    }
});

test("fails to prepare a scene when no active camera is set", () => {
    const scene = new Scene("render-without-camera");
    scene.AddSystem(
        SystemPhase.PrepareRender,
        new RenderSystem({ SetRenderItems() {} }),
    );
    scene.Initialize();

    try {
        assert.throws(
            () => scene.PrepareRender(1, 1),
            /Entity null does not exist/,
        );
    } finally {
        scene.Dispose();
    }
});

test("rejects a renderer without SetRenderItems", () => {
    assert.throws(
        () => new RenderSystem({}),
        /requires a renderer with SetRenderItems/,
    );
});
