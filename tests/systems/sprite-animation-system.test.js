import assert from "node:assert/strict";
import test from "node:test";
import { SpriteAnimator } from "../../src/components/graphics/sprite-animator.js";
import { AstralLogger } from "../../src/diagnostics/logger.js";
import { SpriteAnimationAsset } from "../../src/graphics/sprite-animation-asset.js";
import { SpriteActionRegistry } from "../../src/systems/sprite-action-registry.js";
import { SpriteAnimationEventQueue } from "../../src/systems/sprite-animation-event-queue.js";
import { SpriteAnimationSystem } from "../../src/systems/sprite-animation-system.js";

function CreateAnimation(action) {
    return new SpriteAnimationAsset(
        {
            version: 1,
            textureAssetId: "texture:sprite-sheet",
            grid: { frameWidth: 1, frameHeight: 1, columns: 1 },
            pixelsPerUnit: 1,
            pivot: [0.5, 0.5],
            defaultClip: "idle",
            eventToClip: {},
            clips: {
                idle: {
                    frames: [
                        {
                            frame: 0,
                            durationMs: 100,
                            triggers: [{ action, payload: {} }],
                        },
                    ],
                },
            },
        },
        { bitmap: {}, width: 1, height: 1 },
    );
}

function CreateAnimationWithFrames() {
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
                idle: { frames: [{ frame: 1, durationMs: 100 }] },
                run: { frames: [{ frame: 3, durationMs: 100 }] },
            },
        },
        { bitmap: {}, width: 4, height: 1 },
    );
}

test("reports the initial clip frame before the first update", () => {
    const asset = CreateAnimationWithFrames();
    const handle = {
        AssetId: "animation:sprite",
        Current: asset,
        Version: 1,
    };
    const animator = new SpriteAnimator(handle, "run");
    const defaultAnimator = new SpriteAnimator(handle);

    assert.equal(animator.CurrentFrameIndex, 3);
    assert.equal(defaultAnimator.CurrentFrameIndex, 1);
    assert.deepEqual(asset.GetClipNames(), ["idle", "run"]);
    assert.equal(Object.hasOwn(asset, "Definition"), false);

    animator.Update(0, [], () => {});
    assert.equal(animator.CurrentFrameIndex, 3);
});

test("warns for missing actions and skips them during runtime dispatch", () => {
    const entityId = "entity";
    const handle = {
        AssetId: "animation:sprite",
        Current: CreateAnimation("MissingAction"),
        Version: 1,
    };
    const animator = new SpriteAnimator(handle);
    const scene = {
        EntityManager: {
            Query: () => [entityId],
            GetComponent: () => animator,
        },
        QueryActive: () => [entityId],
    };
    const entries = [];
    const removeSink = AstralLogger.AddSink((entry) => entries.push(entry));
    const system = new SpriteAnimationSystem();

    try {
        system.Initialize(scene, {
            spriteAnimationEvents: new SpriteAnimationEventQueue(),
            spriteActionRegistry: new SpriteActionRegistry(),
        });
        system.FixedUpdate(scene, { deltaTime: 0 });

        assert.equal(entries.length, 1);
        assert.equal(entries[0].level, "WARN");
        assert.match(entries[0].message, /no registered handler/);
        assert.equal(entries[0].details.action, "MissingAction");

        handle.Current = CreateAnimation("ReloadedMissingAction");
        handle.Version += 1;
        system.FixedUpdate(scene, { deltaTime: 0 });
        assert.equal(entries.length, 2);
        assert.equal(entries[1].details.action, "ReloadedMissingAction");
    } finally {
        removeSink();
        system.Shutdown();
    }
});
