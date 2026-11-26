import assert from "node:assert/strict";
import test from "node:test";
import { PlayerControlled } from "../../src/components/gameplay/player-controlled.js";
import { SpriteAnimator } from "../../src/components/graphics/sprite-animator.js";
import { SpriteGameplayInputSystem } from "../../src/systems/sprite-gameplay-input-system.js";

test("queues attack only for active player-controlled sprite animators", () => {
    const componentsByEntity = new Map([
        ["player", new Set([PlayerControlled, SpriteAnimator])],
        ["ambient-sprite", new Set([SpriteAnimator])],
    ]);
    const queuedEvents = [];
    const scene = {
        QueryActive(...componentTypes) {
            return [...componentsByEntity]
                .filter(([, components]) =>
                    componentTypes.every((componentType) =>
                        components.has(componentType),
                    ),
                )
                .map(([entityId]) => entityId);
        },
    };
    const system = new SpriteGameplayInputSystem();

    system.Initialize(scene, {
        input: { WasActionPressed: (action) => action === "attack" },
        QueueSpriteAnimationEvent: (...event) => queuedEvents.push(event),
    });
    system.FixedUpdate(scene);

    assert.deepEqual(queuedEvents, [["player", "attack", {}]]);
});
