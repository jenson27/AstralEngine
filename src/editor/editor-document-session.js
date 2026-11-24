export class EditorDocumentSession {
    constructor(commandHistory, scene) {
        if (
            !commandHistory ||
            typeof commandHistory.Subscribe !== "function"
        ) {
            throw new TypeError(
                "Editor document session requires command history.",
            );
        }

        this._scene = scene ?? null;
        this._isDirty = false;
        this._listeners = new Set();
        this._unsubscribeHistory = commandHistory.Subscribe(
            (_history, change) => {
                if (!change) {
                    return;
                }

                if (
                    ["edit", "undo", "redo"].includes(change.type) &&
                    change.scene === this._scene
                ) {
                    this._isDirty = true;
                    this._Notify();
                }
            },
        );
    }

    get Scene() {
        return this._scene;
    }

    get IsDirty() {
        return this._isDirty;
    }

    MarkExported(scene) {
        if (scene !== this._scene) {
            return false;
        }

        this._isDirty = false;
        this._Notify();
        return true;
    }

    Subscribe(listener) {
        if (typeof listener !== "function") {
            throw new TypeError("Editor document listener must be a function.");
        }

        this._listeners.add(listener);
        listener(this);
        return () => this._listeners.delete(listener);
    }

    Dispose() {
        this._unsubscribeHistory?.();
        this._listeners.clear();
    }

    _Notify() {
        for (const listener of [...this._listeners]) {
            listener(this);
        }
    }
}
