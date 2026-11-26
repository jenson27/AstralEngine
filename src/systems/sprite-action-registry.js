export class SpriteActionRegistry {
    constructor() {
        this._handlers = new Map();
    }

    Register(actionName, handler) {
        if (typeof actionName !== "string" || actionName.trim() === "") {
            throw new TypeError("Sprite action name must be non-empty.");
        }
        if (typeof handler !== "function") {
            throw new TypeError("Sprite action handler must be a function.");
        }
        if (this._handlers.has(actionName)) {
            throw new Error(`Sprite action is already registered: ${actionName}`);
        }
        this._handlers.set(actionName, handler);
    }

    Has(actionName) {
        return this._handlers.has(actionName);
    }

    Invoke(actionName, context) {
        const handler = this._handlers.get(actionName);
        if (!handler) {
            throw new RangeError(`Unknown sprite action: ${actionName}`);
        }
        handler(context);
    }
}
