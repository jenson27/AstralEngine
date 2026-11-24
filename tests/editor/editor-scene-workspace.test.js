import assert from "node:assert/strict";
import test from "node:test";
import { EditorCommandHistory } from "../../src/editor/editor-command-history.js";
import { EditorSceneWorkspace } from "../../src/editor/editor-scene-workspace.js";

class FakeSceneManager {
    constructor() {
        this._activeSceneSession = null;
        this._sessions = new Map();
        this._listeners = new Set();
        this.LoadedUrls = [];
    }

    get ActiveSceneSession() {
        return this._activeSceneSession;
    }

    async LoadSceneSession(url) {
        this.LoadedUrls.push(url);
        return this._CreateSession(url, url.split("/").at(-1));
    }

    async LoadSceneDataSession(data) {
        return this._CreateSession(null, data.name);
    }

    ActivateSceneSession(session) {
        if (session !== null && !this._sessions.has(session)) {
            throw new TypeError("Unknown scene session.");
        }
        if (session === this._activeSceneSession) {
            return null;
        }

        const previousSession = this._activeSceneSession;
        this._activeSceneSession = session;
        for (const listener of [...this._listeners]) {
            listener(this, {
                type: "active-session",
                previousSession,
                session,
            });
        }
        return previousSession;
    }

    DisposeSceneSession(session) {
        if (!this._sessions.has(session)) {
            return Promise.resolve(false);
        }
        if (session === this._activeSceneSession) {
            this.ActivateSceneSession(null);
        }
        this._sessions.delete(session);
        return Promise.resolve(true);
    }

    Subscribe(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    _CreateSession(url, name) {
        const session = Object.freeze({
            Scene: { Name: name },
            Url: url,
        });
        this._sessions.set(session, true);
        return session;
    }
}

function CreateWorkspace() {
    const sceneManager = new FakeSceneManager();
    const commandHistory = new EditorCommandHistory();
    const selection = { Clear() {} };
    const workspace = new EditorSceneWorkspace({
        sceneManager,
        commandHistory,
        selection,
    });
    return { commandHistory, sceneManager, workspace };
}

test("opening an asset scene twice activates its existing document", async (context) => {
    const { sceneManager, workspace } = CreateWorkspace();
    context.after(() => workspace.Dispose());

    const document = await workspace.OpenAssetScene(
        "/assets/scenes/level.scene.json",
        "scenes/level.scene.json",
    );
    const reopenedDocument = await workspace.OpenAssetScene(
        "/assets/scenes/level.scene.json",
        "scenes/level.scene.json",
    );

    assert.strictEqual(reopenedDocument, document);
    assert.strictEqual(workspace.ActiveDocument, document);
    assert.deepEqual(sceneManager.LoadedUrls, [
        "/assets/scenes/level.scene.json",
    ]);
    assert.equal(workspace.GetSnapshot().documents.length, 1);
});

test("scene history stays with its document and dirty documents need discard to close", async (context) => {
    const { commandHistory, workspace } = CreateWorkspace();
    context.after(() => workspace.Dispose());

    const firstDocument = await workspace.OpenAssetScene(
        "/assets/scenes/first.scene.json",
        "scenes/first.scene.json",
    );
    commandHistory.RecordApplied({
        scene: firstDocument.sceneSession.Scene,
        label: "Add entity",
        undo: async () => {},
        redo: async () => {},
    });
    const secondDocument = await workspace.OpenAssetScene(
        "/assets/scenes/second.scene.json",
        "scenes/second.scene.json",
    );

    assert.equal(firstDocument.documentSession.IsDirty, true);
    assert.equal(secondDocument.documentSession.IsDirty, false);
    assert.equal(commandHistory.CanUndo, false);

    workspace.ActivateDocument(firstDocument.id);
    assert.equal(commandHistory.CanUndo, true);
    assert.throws(
        () => workspace.CloseDocument(firstDocument.id),
        /unsaved changes/i,
    );

    assert.equal(
        workspace.CloseDocument(firstDocument.id, { discardChanges: true }),
        true,
    );
    assert.strictEqual(workspace.ActiveDocument, secondDocument);
});
