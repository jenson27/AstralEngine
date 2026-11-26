import assert from "node:assert/strict";
import test from "node:test";
import { SpriteAnimationLoader } from "../../src/graphics/assets/sprite-animation-loader.js";

function CreateDefinition(action = "NotRegistered") {
    return {
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
                        triggers: [{ action, payload: { value: 1 } }],
                    },
                ],
            },
        },
    };
}

test("loads animation data when its action has no registered handler", async () => {
    const texture = { bitmap: {}, width: 1, height: 1 };
    const loader = new SpriteAnimationLoader(async () => ({
        ok: true,
        json: async () => CreateDefinition(),
    }));

    const animation = await loader.Load(
        {
            source: {
                kind: "sprite-animation",
                textureAssetId: "texture:sprite-sheet",
                url: "/animations/sprite.json",
            },
            dependencies: ["texture:sprite-sheet"],
        },
        { GetDependency: () => texture },
    );

    assert.deepEqual(animation.GetActionTriggers(), [
        {
            action: "NotRegistered",
            clipName: "idle",
            frameIndex: 0,
        },
    ]);
    assert.deepEqual(animation.GetClip("idle").steps[0].triggers[0], {
        action: "NotRegistered",
        payload: { value: 1 },
    });
});
