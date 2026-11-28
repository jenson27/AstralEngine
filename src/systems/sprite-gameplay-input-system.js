import { SpriteAnimator } from "../components/graphics/sprite-animator.js";
import { PlayerControlled } from "../components/gameplay/player-controlled.js";

export class SpriteGameplayInputSystem {
    constructor({ input, QueueSpriteAnimationEvent }) {
        if (!input || typeof input.WasActionPressed !== "function") {
            throw new TypeError("SpriteGameplayInputSystem requires an InputManager.");
        }
        if (typeof QueueSpriteAnimationEvent !== "function") {
            throw new TypeError("SpriteGameplayInputSystem requires an animation event queue.");
        }
        this._input = input;
        this._queueSpriteAnimationEvent = QueueSpriteAnimationEvent;
    }

    FixedUpdate(scene) {
        if (!this._input.WasActionPressed("attack")) {
            return;
        }
        for (const entityId of scene.QueryActive(PlayerControlled, SpriteAnimator)) {
            this._queueSpriteAnimationEvent(entityId, "attack", {});
        }
    }
}
