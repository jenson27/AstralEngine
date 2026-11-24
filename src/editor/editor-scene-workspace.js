import { AstralLogger } from "../diagnostics/logger.js";
import { EditorDocumentSession } from "./editor-document-session.js";

function GetFileName(path) {
    return path.split("/").filter(Boolean).at(-1) ?? "Scene";
}

function GetAssetRelativePath(url) {
    if (typeof url !== "string" || !url.startsWith("/assets/")) {
        return null;
    }

    try {
        return url
            .slice("/assets/".length)
            .split("/")
            .map((segment) => decodeURIComponent(segment))
            .join("/");
    } catch {
        return url.slice("/assets/".length);
    }
}

export class EditorSceneWorkspace {
    constructor({
        sceneManager,
        commandHistory,
        selection,
        canChangeActiveScene = () => true,
        logger = AstralLogger,
    }) {
        if (
            !sceneManager ||
            typeof sceneManager.LoadSceneSession !== "function" ||
            typeof sceneManager.LoadSceneDataSession !== "function" ||
            typeof sceneManager.ActivateSceneSession !== "function" ||
            typeof sceneManager.DisposeSceneSession !== "function" ||
            typeof sceneManager.Subscribe !== "function"
        ) {
            throw new TypeError(
                "Editor scene workspace requires scene session management.",
            );
        }
        if (
            !commandHistory ||
            typeof commandHistory.SetScene !== "function" ||
            typeof commandHistory.ForgetScene !== "function" ||
            typeof commandHistory.IsBusy !== "boolean"
        ) {
            throw new TypeError(
                "Editor scene workspace requires editor command history.",
            );
        }
        if (
            !selection ||
            typeof selection.Clear !== "function"
        ) {
            throw new TypeError("Editor scene workspace requires selection.");
        }
        if (typeof canChangeActiveScene !== "function") {
            throw new TypeError(
                "Editor scene workspace requires an active-scene guard.",
            );
        }

        this._sceneManager = sceneManager;
        this._history = commandHistory;
        this._selection = selection;
        this._canChangeActiveScene = canChangeActiveScene;
        this._logger = logger;
        this._documents = new Map();
        this._documentsByPath = new Map();
        this._listeners = new Set();
        this._nextDocumentId = 1;
        this._activeDocumentId = null;
        this._pendingOpenCount = 0;
        this._openQueue = Promise.resolve();
        this._isDisposed = false;
        this._unsubscribeSceneManager = sceneManager.Subscribe(
            (_manager, change) => this._HandleSceneManagerChange(change),
        );

        const activeSession = sceneManager.ActiveSceneSession;
        if (activeSession) {
            const relativePath = GetAssetRelativePath(activeSession.Url);
            const document = this._CreateDocument(
                activeSession,
                relativePath,
                relativePath ? GetFileName(relativePath) : activeSession.Scene.Name,
            );
            this._activeDocumentId = document.id;
            this._history.SetScene(activeSession.Scene);
        }
    }

    get ActiveDocument() {
        return this._documents.get(this._activeDocumentId) ?? null;
    }

    get IsBusy() {
        return this._pendingOpenCount > 0;
    }

    GetDocument(documentId) {
        return this._documents.get(documentId) ?? null;
    }

    GetSnapshot() {
        return {
            documents: [...this._documents.values()].map((document) => ({
                id: document.id,
                title: document.title,
                relativePath: document.relativePath,
                isDirty: document.documentSession.IsDirty,
            })),
            activeDocumentId: this._activeDocumentId,
            isBusy: this.IsBusy,
        };
    }

    Subscribe(listener) {
        if (typeof listener !== "function") {
            throw new TypeError(
                "Editor scene workspace listener must be a function.",
            );
        }

        this._listeners.add(listener);
        listener(this, null);
        return () => this._listeners.delete(listener);
    }

    OpenAssetScene(url, relativePath) {
        this._RequireNotDisposed();
        if (
            typeof url !== "string" ||
            url.trim() === "" ||
            typeof relativePath !== "string" ||
            relativePath.trim() === ""
        ) {
            return Promise.reject(
                new TypeError("Asset scene path must be a non-empty string."),
            );
        }

        const existingDocument = this._documentsByPath.get(relativePath);
        if (existingDocument) {
            this.ActivateDocument(existingDocument.id);
            return Promise.resolve(existingDocument);
        }

        return this._QueueOpen(async () => {
            const currentDocument = this._documentsByPath.get(relativePath);
            if (currentDocument) {
                this.ActivateDocument(currentDocument.id);
                return currentDocument;
            }

            const sceneSession = await this._sceneManager.LoadSceneSession(url);
            return this._RegisterAndActivate(sceneSession, {
                relativePath,
                title: GetFileName(relativePath),
            });
        });
    }

    OpenImportedScene(data, fileName) {
        this._RequireNotDisposed();
        if (typeof fileName !== "string" || fileName.trim() === "") {
            return Promise.reject(
                new TypeError("Imported scene file name must be a string."),
            );
        }

        return this._QueueOpen(async () => {
            const sceneSession = await this._sceneManager.LoadSceneDataSession(data);
            const title = this._GetUniqueImportedTitle(fileName);
            return this._RegisterAndActivate(sceneSession, {
                relativePath: null,
                title,
            });
        });
    }

    ActivateDocument(documentId) {
        this._RequireNotDisposed();
        const document = this._documents.get(documentId);
        if (!document) {
            return false;
        }
        if (
            documentId === this._activeDocumentId &&
            document.sceneSession === this._sceneManager.ActiveSceneSession
        ) {
            return false;
        }

        this._RequireSceneCanChange();
        this._sceneManager.ActivateSceneSession(document.sceneSession);
        return true;
    }

    CloseDocument(documentId, { discardChanges = false } = {}) {
        this._RequireNotDisposed();
        const document = this._documents.get(documentId);
        if (!document) {
            return false;
        }
        if (document.documentSession.IsDirty && !discardChanges) {
            throw new Error(
                "Export or discard unsaved changes before closing this scene.",
            );
        }

        this._RequireSceneCanChange();
        if (documentId === this._activeDocumentId) {
            const documents = [...this._documents.values()];
            const documentIndex = documents.indexOf(document);
            const nextDocument =
                documents[documentIndex - 1] ?? documents[documentIndex + 1];
            this._sceneManager.ActivateSceneSession(
                nextDocument?.sceneSession ?? null,
            );
        }

        this._RemoveDocument(document);
        void this._sceneManager.DisposeSceneSession(document.sceneSession);
        this._Notify({ type: "closed", documentId });
        return true;
    }

    Dispose() {
        if (this._isDisposed) {
            return;
        }

        this._isDisposed = true;
        this._unsubscribeSceneManager?.();
        this._unsubscribeSceneManager = null;

        for (const document of [...this._documents.values()]) {
            this._RemoveDocument(document);
            void this._sceneManager.DisposeSceneSession(
                document.sceneSession,
            );
        }

        this._activeDocumentId = null;
        this._history.SetScene(null);
        this._selection.Clear();
        this._listeners.clear();
    }

    _QueueOpen(operation) {
        this._pendingOpenCount += 1;
        this._Notify({ type: "open-queued" });
        const queuedOperation = this._openQueue.then(async () => {
            this._RequireNotDisposed();
            return operation();
        }).finally(() => {
            this._pendingOpenCount -= 1;
            this._Notify({ type: "open-finished" });
        });
        this._openQueue = queuedOperation.catch(() => {});
        return queuedOperation;
    }

    async _RegisterAndActivate(sceneSession, { relativePath, title }) {
        if (this._isDisposed) {
            await this._sceneManager.DisposeSceneSession(sceneSession);
            throw new Error("Editor scene workspace has been disposed.");
        }

        const existingDocument = this._FindDocumentBySession(sceneSession);
        if (existingDocument) {
            this.ActivateDocument(existingDocument.id);
            return existingDocument;
        }

        const document = this._CreateDocument(
            sceneSession,
            relativePath,
            title,
        );
        try {
            this.ActivateDocument(document.id);
            return document;
        } catch (error) {
            this._RemoveDocument(document);
            await this._sceneManager.DisposeSceneSession(sceneSession);
            throw error;
        }
    }

    _CreateDocument(sceneSession, relativePath, title) {
        const document = {
            id: `scene-document-${this._nextDocumentId++}`,
            title,
            relativePath,
            sceneSession,
            documentSession: new EditorDocumentSession(
                this._history,
                sceneSession.Scene,
            ),
            unsubscribeDocument: null,
        };

        this._documents.set(document.id, document);
        if (relativePath) {
            this._documentsByPath.set(relativePath, document);
        }
        document.unsubscribeDocument = document.documentSession.Subscribe(() =>
            this._Notify({
                type: "document",
                documentId: document.id,
            }),
        );
        return document;
    }

    _GetUniqueImportedTitle(fileName) {
        const normalizedName = GetFileName(fileName.trim());
        const existingTitles = new Set(
            [...this._documents.values()].map((document) => document.title),
        );
        if (!existingTitles.has(normalizedName)) {
            return normalizedName;
        }

        let suffix = 2;
        while (existingTitles.has(`${normalizedName} (${suffix})`)) {
            suffix += 1;
        }
        return `${normalizedName} (${suffix})`;
    }

    _HandleSceneManagerChange(change) {
        if (this._isDisposed || change?.type !== "active-session") {
            return;
        }

        const { previousSession, session } = change;
        let document = this._FindDocumentBySession(session);
        const previousDocument = this._FindDocumentBySession(previousSession);

        if (
            session &&
            !document &&
            previousDocument &&
            previousDocument.id === this._activeDocumentId
        ) {
            this._ReplaceDocumentSession(previousDocument, session);
            document = previousDocument;
        } else if (session && !document) {
            const relativePath = GetAssetRelativePath(session.Url);
            const existingDocument = relativePath
                ? this._documentsByPath.get(relativePath)
                : null;
            if (existingDocument) {
                this._ReplaceDocumentSession(existingDocument, session);
                document = existingDocument;
            } else {
                document = this._CreateDocument(
                    session,
                    relativePath,
                    relativePath
                        ? GetFileName(relativePath)
                        : session.Scene.Name,
                );
            }
        }

        if (previousSession !== session) {
            this._selection.Clear();
        }
        this._activeDocumentId = document?.id ?? null;
        this._history.SetScene(session?.Scene ?? null);
        this._Notify({ type: "active" });
    }

    _ReplaceDocumentSession(document, sceneSession) {
        const previousScene = document.sceneSession.Scene;
        document.unsubscribeDocument?.();
        document.documentSession.Dispose();
        this._history.ForgetScene(previousScene);

        if (document.relativePath) {
            this._documentsByPath.delete(document.relativePath);
        }

        const relativePath = GetAssetRelativePath(sceneSession.Url);
        document.sceneSession = sceneSession;
        document.relativePath = relativePath;
        if (relativePath) {
            document.title = GetFileName(relativePath);
            this._documentsByPath.set(relativePath, document);
        } else {
            document.title = sceneSession.Scene.Name;
        }
        document.documentSession = new EditorDocumentSession(
            this._history,
            sceneSession.Scene,
        );
        document.unsubscribeDocument = document.documentSession.Subscribe(() =>
            this._Notify({
                type: "document",
                documentId: document.id,
            }),
        );
    }

    _FindDocumentBySession(sceneSession) {
        if (!sceneSession) {
            return null;
        }
        return (
            [...this._documents.values()].find(
                (document) => document.sceneSession === sceneSession,
            ) ?? null
        );
    }

    _RemoveDocument(document) {
        this._documents.delete(document.id);
        if (
            document.relativePath &&
            this._documentsByPath.get(document.relativePath) === document
        ) {
            this._documentsByPath.delete(document.relativePath);
        }
        document.unsubscribeDocument?.();
        document.documentSession.Dispose();
        this._history.ForgetScene(document.sceneSession.Scene);
    }

    _RequireSceneCanChange() {
        if (this._history.IsBusy || !this._canChangeActiveScene()) {
            throw new Error("Wait for the current editor action to finish.");
        }
    }

    _RequireNotDisposed() {
        if (this._isDisposed) {
            throw new Error("Editor scene workspace has been disposed.");
        }
    }

    _Notify(change) {
        for (const listener of [...this._listeners]) {
            try {
                listener(this, change);
            } catch (error) {
                this._logger?.Error?.(
                    "Editor scene workspace listener failed.",
                    error,
                );
            }
        }
    }
}
