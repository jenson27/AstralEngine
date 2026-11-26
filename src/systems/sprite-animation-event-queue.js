import { IsEntityId } from "../core/ecs/entity-id.js";

export class SpriteAnimationEventQueue {
    constructor() {
        this._events = [];
    }

    Enqueue(entityId, eventName, payload = {}) {
        if (!IsEntityId(entityId)) {
            throw new TypeError("Sprite animation events need a valid entity ID.");
        }
        if (typeof eventName !== "string" || eventName.trim() === "") {
            throw new TypeError("Sprite animation event name must be non-empty.");
        }
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
            throw new TypeError("Sprite animation event payload must be an object.");
        }
        this._events.push({
            entityId,
            eventName,
            payload: JSON.parse(JSON.stringify(payload)),
        });
    }

    Drain() {
        const events = this._events;
        this._events = [];
        return events;
    }

    Clear() {
        this._events.length = 0;
    }
}
