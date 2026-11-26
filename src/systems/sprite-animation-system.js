import { AstralLogger } from "../diagnostics/logger.js";
import { SpriteAnimator } from "../components/graphics/sprite-animator.js";

export class SpriteAnimationSystem {
    Initialize(scene, services) {
        if (!services.spriteAnimationEvents || typeof services.spriteAnimationEvents.Drain !== "function") {
            throw new TypeError("SpriteAnimationSystem requires an event queue.");
        }
        if (
            !services.spriteActionRegistry ||
            typeof services.spriteActionRegistry.Invoke !== "function" ||
            typeof services.spriteActionRegistry.Has !== "function"
        ) {
            throw new TypeError("SpriteAnimationSystem requires an action registry.");
        }
        this._eventQueue = services.spriteAnimationEvents;
        this._actionRegistry = services.spriteActionRegistry;
        this._validatedAnimationAssets = new WeakSet();

        for (const entityId of scene.EntityManager.Query(SpriteAnimator)) {
            this._ValidateAnimationActions(
                scene.EntityManager.GetComponent(entityId, SpriteAnimator),
            );
        }
    }

    FixedUpdate(scene, { deltaTime }) {
        const eventsByEntity = new Map();
        for (const eventRecord of this._eventQueue.Drain()) {
            let events = eventsByEntity.get(eventRecord.entityId);
            if (!events) {
                events = [];
                eventsByEntity.set(eventRecord.entityId, events);
            }
            events.push(eventRecord);
        }

        const actions = [];
        const entityManager = scene.EntityManager;
        for (const entityId of scene.QueryActive(SpriteAnimator)) {
            const animator = entityManager.GetComponent(entityId, SpriteAnimator);
            this._ValidateAnimationActions(animator);
            animator.Update(deltaTime, eventsByEntity.get(entityId) ?? [], (trigger) => {
                actions.push({ entityId, trigger });
            });
        }

        for (const { entityId, trigger } of actions) {
            if (!this._actionRegistry.Has(trigger.action)) {
                continue;
            }
            try {
                this._actionRegistry.Invoke(trigger.action, {
                    scene,
                    entityId,
                    action: trigger.action,
                    payload: trigger.payload,
                    eventName: trigger.eventName,
                    eventPayload: trigger.eventPayload,
                    clipName: trigger.clipName,
                    frameIndex: trigger.frameIndex,
                    sequenceIndex: trigger.sequenceIndex,
                    loopCount: trigger.loopCount,
                });
            } catch (error) {
                AstralLogger.Error("Sprite animation action failed.", {
                    entityId,
                    action: trigger.action,
                    clipName: trigger.clipName,
                    frameIndex: trigger.frameIndex,
                    error,
                });
            }
        }
    }

    _ValidateAnimationActions(animator) {
        const animation = animator?.AnimationHandle?.Current;
        if (!animation || typeof animation.GetActionTriggers !== "function") {
            throw new TypeError(
                "SpriteAnimator requires an animation asset with action trigger metadata.",
            );
        }
        if (this._validatedAnimationAssets.has(animation)) {
            return;
        }

        this._validatedAnimationAssets.add(animation);
        const reportedActions = new Set();
        for (const trigger of animation.GetActionTriggers()) {
            if (
                this._actionRegistry.Has(trigger.action) ||
                reportedActions.has(trigger.action)
            ) {
                continue;
            }
            reportedActions.add(trigger.action);
            AstralLogger.Warn(
                "Sprite animation action has no registered handler; it will be skipped.",
                {
                    assetId: animator.AnimationHandle.AssetId,
                    action: trigger.action,
                    clipName: trigger.clipName,
                    frameIndex: trigger.frameIndex,
                },
            );
        }
    }

    Shutdown() {
        this._eventQueue?.Clear();
    }
}
