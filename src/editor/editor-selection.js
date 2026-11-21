export class EditorSelection {
    constructor() {
        this._current = null;
        this._listeners = new Set();
    }

    get Current() {
        return this._current;
    }

    Select(scene, entityId) {
        if (!scene?.EntityManager || typeof entityId !== "string") {
            throw new TypeError(
                "Editor selection requires a scene and entity ID.",
            );
        }

        scene.EntityManager.GetEntityName(entityId);
        return this._Set({ scene, entityId });
    }

    Clear() {
        return this._Set(null);
    }

    Subscribe(listener) {
        if (typeof listener !== "function") {
            throw new TypeError("Selection listener must be a function.");
        }

        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    _Set(selection) {
        if (
            this._current?.scene === selection?.scene &&
            this._current?.entityId === selection?.entityId
        ) {
            return false;
        }

        this._current =
            selection === null ? null : Object.freeze(selection);

        for (const listener of [...this._listeners]) {
            listener(this._current);
        }

        return true;
    }
}
