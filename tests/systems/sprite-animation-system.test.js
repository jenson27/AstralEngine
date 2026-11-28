import assert from "node:assert/strict";
import test from "node:test";
import { SpriteAnimator } from "../../src/components/graphics/sprite-animator.js";
import { AstralLogger } from "../../src/diagnostics/logger.js";
import { AssetHandle } from "../../src/core/assets/asset-handle.js";
import { Scene } from "../../src/core/scene/scene.js";
import { SpriteAnimationAsset } from "../../src/graphics/sprite-animation-asset.js";
import { SpriteActionRegistry } from "../../src/systems/sprite-action-registry.js";
import { SpriteAnimationEventQueue } from "../../src/systems/sprite-animation-event-queue.js";
import { SpriteAnimationSystem } from "../../src/systems/sprite-animation-system.js";

function CreateAnimation({ idleAction, attackAction } = {}) {
    const idleTriggers = idleAction
        ? [{ action: idleAction, payload: { source: "idle" } }]
        : [];
    const attackTriggers = attackAction
        ? [{ action: attackAction, payload: { damage: 5 } }]
        : [];

    return new SpriteAnimationAsset(
        {
            version: 1,
            textureAssetId: "texture:sprite-sheet",
            grid: { frameWidth: 1, frameHeight: 1, columns: 2 },
            pixelsPerUnit: 1,
            pivot: [0.5, 0.5],
            defaultClip: "idle",
            eventToClip: { attack: "attack" },
            clips: {
                idle: {
                    frames: [{ frame: 0, durationMs: 1000, triggers: idleTriggers }],
                },
                attack: {
                    priority: 1,
                    frames: [{ frame: 1, durationMs: 1000, triggers: attackTriggers }],
                },
            },
        },
        { bitmap: {}, width: 2, height: 1 },
    );
}

function CreateLoadedHandle(assetId, asset) {
    const handle = new AssetHandle(assetId);
    handle._Replace(asset);
    return handle;
}

function CreateAnimationScene(animators, { queue, actions, name } = {}) {
    const scene = new Scene(name ?? "sprite-animation-system-test");
    const entityIds = animators.map((animator, index) => {
        const entityId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
        scene.EntityManager.CreateEntity(entityId);
        scene.EntityManager.AddComponent(entityId, SpriteAnimator, animator);
        return entityId;
    });
    const system = new SpriteAnimationSystem();
    scene.AddSystem("fixed-update", system);
    scene.Initialize({
        spriteAnimationEvents: queue,
        spriteActionRegistry: actions,
    });
    return { entityIds, scene, system };
}

test("advances real animators and dispatches frame actions through a scene", () => {
    const handle = CreateLoadedHandle(
        "animation:combat",
        CreateAnimation({ idleAction: "IdleEntered", attackAction: "AttackImpact" }),
    );
    const queue = new SpriteAnimationEventQueue();
    const actions = new SpriteActionRegistry();
    const dispatched = [];
    actions.Register("IdleEntered", (context) => dispatched.push(context));
    actions.Register("AttackImpact", (context) => dispatched.push(context));
    const animator = new SpriteAnimator(handle);
    const { entityIds, scene } = CreateAnimationScene([animator], {
        queue,
        actions,
    });

    try {
        queue.Enqueue(entityIds[0], "attack", { combo: 2 });
        scene.FixedUpdate(0, 0);

        assert.deepEqual(
            dispatched.map(({ action, payload, eventName, eventPayload }) => ({
                action,
                payload,
                eventName,
                eventPayload,
            })),
            [
                {
                    action: "IdleEntered",
                    payload: { source: "idle" },
                    eventName: null,
                    eventPayload: {},
                },
                {
                    action: "AttackImpact",
                    payload: { damage: 5 },
                    eventName: "attack",
                    eventPayload: { combo: 2 },
                },
            ],
        );
        assert.equal(dispatched[1].scene, scene);
        assert.equal(dispatched[1].entityId, entityIds[0]);
        assert.equal(animator.CurrentClipName, "attack");
        assert.equal(animator.CurrentFrameIndex, 1);
    } finally {
        scene.Dispose();
    }
});

test("continues dispatch after an action handler throws", () => {
    const handle = CreateLoadedHandle(
        "animation:shared",
        CreateAnimation({ idleAction: "RecordEntry" }),
    );
    const queue = new SpriteAnimationEventQueue();
    const actions = new SpriteActionRegistry();
    const dispatched = [];
    const errors = [];
    const removeSink = AstralLogger.AddSink((entry) => errors.push(entry));
    actions.Register("RecordEntry", ({ entityId }) => {
        if (entityId.endsWith("000000000001")) {
            throw new Error("handler failure");
        }
        dispatched.push(entityId);
    });
    const animators = [new SpriteAnimator(handle), new SpriteAnimator(handle)];
    const { entityIds, scene } = CreateAnimationScene(animators, {
        queue,
        actions,
    });

    try {
        scene.FixedUpdate(0, 0);

        assert.deepEqual(dispatched, [entityIds[1]]);
        assert.equal(errors.filter((entry) => entry.message === "Sprite animation action failed.").length, 1);
    } finally {
        removeSink();
        scene.Dispose();
    }
});

test("warns once per missing action for each animation asset", () => {
    const handle = CreateLoadedHandle(
        "animation:missing-actions",
        CreateAnimation({ idleAction: "MissingAction" }),
    );
    const queue = new SpriteAnimationEventQueue();
    const actions = new SpriteActionRegistry();
    const entries = [];
    const removeSink = AstralLogger.AddSink((entry) => entries.push(entry));
    const animators = [new SpriteAnimator(handle), new SpriteAnimator(handle)];
    const { scene } = CreateAnimationScene(animators, { queue, actions });

    try {
        assert.equal(
            entries.filter((entry) => entry.message.includes("no registered handler")).length,
            1,
        );
        scene.FixedUpdate(0, 0);
        assert.equal(
            entries.filter((entry) => entry.message.includes("no registered handler")).length,
            1,
        );

        handle._Replace(CreateAnimation({ idleAction: "ReloadedMissingAction" }));
        scene.FixedUpdate(0, 0);
        const warnings = entries.filter((entry) =>
            entry.message.includes("no registered handler"),
        );
        assert.equal(warnings.length, 2);
        assert.equal(warnings[1].details.action, "ReloadedMissingAction");
    } finally {
        removeSink();
        scene.Dispose();
    }
});

test("requires an animation event queue and action registry", () => {
    const scene = new Scene("sprite-animation-service-validation");
    const system = new SpriteAnimationSystem();
    const queue = new SpriteAnimationEventQueue();
    const actions = new SpriteActionRegistry();

    assert.throws(
        () => system.Initialize(scene, { spriteActionRegistry: actions }),
        /requires an event queue/,
    );
    assert.throws(
        () => system.Initialize(scene, { spriteAnimationEvents: queue }),
        /requires an action registry/,
    );
    scene.Dispose();
});

test("clears queued events when the scene shuts down", () => {
    const queue = new SpriteAnimationEventQueue();
    const actions = new SpriteActionRegistry();
    const { entityIds, scene } = CreateAnimationScene(
        [new SpriteAnimator(CreateLoadedHandle("animation:idle", CreateAnimation()))],
        { queue, actions },
    );
    queue.Enqueue(entityIds[0], "attack");

    scene.Dispose();

    assert.deepEqual(queue.Drain(), []);
});
