import { SpriteAnimator } from "../components/graphics/sprite-animator.js";
import { PlayerControlled } from "../components/gameplay/player-controlled.js";

export class SpriteGameplayInputSystem {
    Initialize(scene, services) {
        if (!services.input || typeof services.input.WasActionPressed !== "function") {
            throw new TypeError("SpriteGameplayInputSystem requires an InputManager.");
        }
        if (typeof services.QueueSpriteAnimationEvent !== "function") {
            throw new TypeError("SpriteGameplayInputSystem requires an animation event queue.");
        }
        this._input = services.input;
        this._queueSpriteAnimationEvent = services.QueueSpriteAnimationEvent;
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
