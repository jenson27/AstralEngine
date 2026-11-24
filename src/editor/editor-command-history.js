export class EditorCommandHistory {
    constructor(maxEntries = 100) {
        if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
            throw new RangeError("Editor history limit must be a positive integer.");
        }

        this._maxEntries = maxEntries;
        this._sceneStates = new WeakMap();
        this._scene = null;
        this._undoStack = [];
        this._redoStack = [];
        this._listeners = new Set();
        this._isBusy = false;
    }

    get CanUndo() {
        return !this._isBusy && this._undoStack.length > 0;
    }

    get CanRedo() {
        return !this._isBusy && this._redoStack.length > 0;
    }

    get IsBusy() {
        return this._isBusy;
    }

    get UndoLabel() {
        return this._undoStack.at(-1)?.label ?? "";
    }

    get RedoLabel() {
        return this._redoStack.at(-1)?.label ?? "";
    }

    GetRetainedAssetIds() {
        return [
            ...new Set(
                [...this._undoStack, ...this._redoStack].flatMap(
                    (command) => command.retainedAssetIds,
                ),
            ),
        ];
    }

    SetScene(scene) {
        if (scene !== null && typeof scene !== "object") {
            throw new TypeError("Editor history scene must be an object or null.");
        }
        if (scene === this._scene) {
            return false;
        }

        this._scene = scene;
        const state = scene ? this._GetOrCreateSceneState(scene) : null;
        this._undoStack = state?.undoStack ?? [];
        this._redoStack = state?.redoStack ?? [];
        this._Notify({ type: "scene", scene });
        return true;
    }

    ForgetScene(scene) {
        if (!scene || typeof scene !== "object") {
            return false;
        }

        const didForget = this._sceneStates.delete(scene);
        if (!didForget) {
            return false;
        }

        if (scene === this._scene) {
            this._scene = null;
            this._undoStack = [];
            this._redoStack = [];
            this._Notify({ type: "scene", scene: null });
        }
        return true;
    }

    RecordApplied({ scene, label, undo, redo, retainedAssetIds = [] }) {
        if (
            scene !== this._scene ||
            typeof label !== "string" ||
            label.trim() === "" ||
            typeof undo !== "function" ||
            typeof redo !== "function" ||
            !Array.isArray(retainedAssetIds) ||
            !retainedAssetIds.every(
                (assetId) =>
                    typeof assetId === "string" && assetId.trim() !== "",
            )
        ) {
            throw new TypeError("Invalid editor history command.");
        }

        if (this._isBusy) {
            throw new Error("Cannot record an edit while editor history is busy.");
        }

        this._undoStack.push({
            scene,
            label: label.trim(),
            undo,
            redo,
            retainedAssetIds: [...new Set(retainedAssetIds)],
        });
        if (this._undoStack.length > this._maxEntries) {
            this._undoStack.shift();
        }
        this._redoStack.length = 0;
        this._Notify({ type: "edit", scene });
    }

    Undo() {
        return this._Move(this._undoStack, this._redoStack, "undo");
    }

    Redo() {
        return this._Move(this._redoStack, this._undoStack, "redo");
    }

    Subscribe(listener) {
        if (typeof listener !== "function") {
            throw new TypeError("Editor history listener must be a function.");
        }

        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    _GetOrCreateSceneState(scene) {
        let state = this._sceneStates.get(scene);
        if (!state) {
            state = { undoStack: [], redoStack: [] };
            this._sceneStates.set(scene, state);
        }
        return state;
    }

    async _Move(source, destination, action) {
        const command = source.at(-1);
        if (!command) {
            return false;
        }
        if (this._isBusy) {
            throw new Error("Editor history is busy.");
        }

        this._isBusy = true;
        this._Notify({ type: "busy", scene: command.scene });
        try {
            await command[action]();
            if (command.scene !== this._scene || source.at(-1) !== command) {
                return false;
            }
            source.pop();
            destination.push(command);
            this._Notify({ type: action, scene: command.scene });
            return true;
        } finally {
            this._isBusy = false;
            this._Notify({ type: "busy", scene: this._scene });
        }
    }

    _Notify(change = null) {
        for (const listener of [...this._listeners]) {
            listener(this, change);
        }
    }
}
