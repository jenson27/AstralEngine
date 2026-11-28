import assert from "node:assert/strict";
import test from "node:test";
import { SpriteAnimator } from "../../src/components/graphics/sprite-animator.js";
import { SpriteRenderer } from "../../src/components/graphics/sprite-renderer.js";
import { Transform } from "../../src/components/transform.js";
import { SpriteAnimationAsset } from "../../src/graphics/sprite-animation-asset.js";
import { CreateEditorComponentAuthoringCatalog } from "../../src/editor/component-authoring-catalog.js";

const ANIMATION_ASSET_ID = "sprite-animation:test";

function CreateAnimation(idleFrame, runFrame) {
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
                idle: { frames: [{ frame: idleFrame, durationMs: 100 }] },
                run: { frames: [{ frame: runFrame, durationMs: 100 }] },
            },
        },
        { bitmap: {}, width: 4, height: 1 },
    );
}

function CreateHandle(assetId, idleFrame, runFrame) {
    return {
        AssetId: assetId,
        Current: CreateAnimation(idleFrame, runFrame),
        Version: 1,
    };
}

test("registers sprite components with the required add order", () => {
    const catalog = CreateEditorComponentAuthoringCatalog();
    const componentTypes = new Set([Transform]);
    const entityManager = {
        HasComponent: (_entityId, componentType) =>
            componentTypes.has(componentType),
    };

    let addableIds = catalog
        .GetAddable(entityManager, "entity")
        .map(({ typeId }) => typeId);
    assert.ok(addableIds.includes("spriteRenderer"));
    assert.equal(addableIds.includes("spriteAnimator"), false);

    componentTypes.add(SpriteRenderer);
    addableIds = catalog
        .GetAddable(entityManager, "entity")
        .map(({ typeId }) => typeId);
    assert.ok(addableIds.includes("spriteAnimator"));
    assert.equal(catalog.GetInspectorByType(SpriteRenderer).title, "Sprite Renderer");
    assert.equal(catalog.GetInspectorByType(SpriteAnimator).title, "Sprite Animator");
});

test("creates a sprite animator from a registered animation asset", async () => {
    const catalog = CreateEditorComponentAuthoringCatalog();
    const handle = CreateHandle(ANIMATION_ASSET_ID, 0, 1);
    const descriptor = { id: ANIMATION_ASSET_ID, typeId: "sprite-animation" };
    const assetCatalog = {
        GetAll: () => [descriptor],
        GetRequired: (assetId) => {
            if (assetId !== descriptor.id) {
                throw new Error("Unknown asset.");
            }
            return descriptor;
        },
    };
    const animator = await catalog.Create("spriteAnimator", {
        values: { animationAssetId: ANIMATION_ASSET_ID },
        getAssetMetadata: () => assetCatalog,
        acquireAssetHandle: async (assetId) => {
            assert.equal(assetId, ANIMATION_ASSET_ID);
            return handle;
        },
    });

    assert.ok(animator instanceof SpriteAnimator);
    assert.equal(animator.AnimationHandle, handle);
});

test("edits sprite renderer settings atomically through its inspector", () => {
    const catalog = CreateEditorComponentAuthoringCatalog();
    const inspector = catalog.GetInspectorByType(SpriteRenderer);
    const component = new SpriteRenderer();

    inspector.apply({
        component,
        input: { value: "cylindrical" },
        fieldId: "spriteRenderer.billboardMode",
        readNumber: (input) => Number(input.value),
    });
    inspector.apply({
        component,
        input: { value: "0.25" },
        fieldId: "spriteRenderer.tint.0",
        readNumber: (input) => Number(input.value),
    });

    assert.equal(component.billboardMode, "cylindrical");
    assert.deepEqual(component.tint, [0.25, 1, 1, 1]);

    const previousSettings = inspector.capture({ component });
    assert.throws(
        () => component.SetSettings({ tint: [0.1, 0.2, 0.3, 1.5] }),
        /between 0 and 1/,
    );
    assert.deepEqual(inspector.capture({ component }), previousSettings);
});

test("sprite animator inspector changes and restores asset and clip settings", async () => {
    const catalog = CreateEditorComponentAuthoringCatalog();
    const inspector = catalog.GetInspectorByType(SpriteAnimator);
    const firstHandle = CreateHandle("sprite-animation:first", 0, 1);
    const nextHandle = CreateHandle("sprite-animation:next", 2, 3);
    const component = new SpriteAnimator(firstHandle, "run");
    component.Update(0, [], () => {});
    const previousState = inspector.capture({ component });

    const preparedAssetChange = await inspector.prepareApply({
        component,
        input: { value: nextHandle.AssetId },
        fieldId: "spriteAnimator.animationAssetId",
        assetAccess: {
            RequireType: (assetId, assetType) => {
                assert.equal(assetId, nextHandle.AssetId);
                assert.equal(assetType, "sprite-animation");
            },
            AcquireHandle: async () => nextHandle,
        },
    });
    preparedAssetChange.Commit();

    assert.equal(component.AnimationHandle, nextHandle);
    assert.equal(component.InitialClip, "run");
    assert.equal(component.CurrentFrameIndex, 3);
    assert.deepEqual(
        catalog.GetAssetIdsForState(SpriteAnimator, previousState),
        [firstHandle.AssetId],
    );

    const preparedClipChange = await inspector.prepareApply({
        component,
        input: { value: "idle" },
        fieldId: "spriteAnimator.initialClip",
        assetAccess: {},
    });
    preparedClipChange.Commit();
    assert.equal(component.CurrentFrameIndex, 2);

    inspector.restore({ component, value: previousState });
    assert.equal(component.AnimationHandle, firstHandle);
    assert.equal(component.InitialClip, "run");
    assert.equal(component.CurrentFrameIndex, 1);
});
