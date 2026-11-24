import { AstralLogger } from "../../diagnostics/logger.js";

function IsSceneCandidate(scene) {
    return (
        scene !== null &&
        typeof scene === "object" &&
        typeof scene.Name === "string" &&
        scene.Name.trim() !== "" &&
        typeof scene.FixedUpdate === "function" &&
        typeof scene.PrepareRender === "function" &&
        typeof scene.Dispose === "function"
    );
}

export class SceneManager {
    constructor(
        sceneLoader,
        createLoadOptions = () => ({}),
        createAssetScope = null,
    ) {
        if (!sceneLoader || typeof sceneLoader.Load !== "function") {
            throw new TypeError(
                "SceneManager requires a scene loader with a Load method.",
            );
        }

        if (typeof createLoadOptions !== "function") {
            throw new TypeError(
                "SceneManager requires a load options factory.",
            );
        }

        if (
            createAssetScope !== null &&
            typeof createAssetScope !== "function"
        ) {
            throw new TypeError(
                "SceneManager asset scope factory must be a function.",
            );
        }

        this._sceneLoader = sceneLoader;
        this._createLoadOptions = createLoadOptions;
        this._createAssetScope = createAssetScope;
        this._sceneSessions = new Map();
        this._pendingSessionDisposals = new Set();
        this._activeSceneSession = null;
        this._listeners = new Set();
        this._isLoading = false;
        this._loadCompletion = null;
        this._isDisposed = false;
        this._disposePromise = null;
    }

    get ActiveScene() {
        return this._activeSceneSession?.Scene ?? null;
    }

    get ActiveSceneUrl() {
        return this._activeSceneSession?.Url ?? null;
    }

    get ActiveSceneSession() {
        return this._activeSceneSession;
    }

    async AcquireAssetHandle(assetId) {
        this._RequireNotDisposed();

        const activeSession = this._activeSceneSession;
        const assetScope = activeSession
            ? this._sceneSessions.get(activeSession)
            : null;
        if (!activeSession || !assetScope) {
            throw new Error("SceneManager has no active asset scope.");
        }

        await assetScope.Acquire(assetId);

        if (activeSession !== this._activeSceneSession) {
            throw new Error("Active scene changed while acquiring the asset.");
        }

        return assetScope.GetHandleRequired(assetId);
    }

    RetainActiveAssetHandles(scene, assetIds) {
        const activeSession = this._activeSceneSession;
        const assetScope = activeSession
            ? this._sceneSessions.get(activeSession)
            : null;
        if (scene !== activeSession?.Scene || !assetScope) {
            return Promise.resolve(false);
        }

        return assetScope.RetainOnly(assetIds).then(() => true);
    }

    async LoadScene(url) {
        return this._LoadAndActivate(this.LoadSceneSession(url));
    }

    LoadSceneSession(url) {
        return this._LoadCandidate(url, (options) =>
            this._sceneLoader.Load(url, options),
        );
    }

    async LoadSceneData(data) {
        return this._LoadAndActivate(this.LoadSceneDataSession(data));
    }

    async _LoadAndActivate(sessionPromise) {
        const session = await sessionPromise;
        try {
            const previousSession = this.ActivateSceneSession(session);
            if (previousSession) {
                await this.DisposeSceneSession(previousSession);
            }
            this._RequireNotDisposed();
            return session.Scene;
        } catch (error) {
            await this.DisposeSceneSession(session);
            throw error;
        }
    }

    LoadSceneDataSession(data) {
        if (typeof this._sceneLoader.LoadDataAsync !== "function") {
            throw new TypeError("Scene loader cannot load scene data.");
        }

        return this._LoadCandidate(null, (options) =>
            this._sceneLoader.LoadDataAsync(data, options),
        );
    }

    ActivateSceneSession(session) {
        this._RequireNotDisposed();
        if (session !== null && !this._sceneSessions.has(session)) {
            throw new TypeError("Scene session is not owned by this manager.");
        }
        if (session === this._activeSceneSession) {
            return null;
        }

        const previousSession = this._activeSceneSession;
        this._activeSceneSession = session;
        this._Notify({
            type: "active-session",
            previousSession,
            session,
        });
        return previousSession;
    }

    DisposeSceneSession(session) {
        if (!this._sceneSessions.has(session)) {
            return Promise.resolve(false);
        }

        if (session === this._activeSceneSession) {
            this.ActivateSceneSession(null);
        }

        const assetScope = this._sceneSessions.get(session);
        this._sceneSessions.delete(session);

        const disposalPromise = this._DisposeSceneSession(
            session,
            assetScope,
        );
        this._pendingSessionDisposals.add(disposalPromise);
        return disposalPromise.finally(() =>
            this._pendingSessionDisposals.delete(disposalPromise),
        );
    }

    async _DisposeSceneSession(session, assetScope) {
        try {
            session.Scene.Dispose();
        } catch (error) {
            AstralLogger.Error(
                "Scene session failed to dispose.",
                error,
            );
        }

        await this._ReleaseAssetScope(
            assetScope,
            "Scene session assets failed to release.",
        );
        return true;
    }

    Subscribe(listener) {
        if (typeof listener !== "function") {
            throw new TypeError("Scene manager listener must be a function.");
        }

        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    FixedUpdate(deltaTime, elapsedTime, diagnostics = null) {
        this._RequireNotDisposed();
        this._activeSceneSession?.Scene.FixedUpdate(
            deltaTime,
            elapsedTime,
            diagnostics,
        );
    }

    PrepareRender(interpolationAlpha, aspectRatio, diagnostics = null) {
        this._RequireNotDisposed();
        this._activeSceneSession?.Scene.PrepareRender(
            interpolationAlpha,
            aspectRatio,
            diagnostics,
        );
    }

    Dispose() {
        if (this._disposePromise) {
            return this._disposePromise;
        }

        if (this._isDisposed) {
            return Promise.resolve();
        }

        this._isDisposed = true;
        const sessions = [...this._sceneSessions.entries()];
        const pendingSessionDisposals = [
            ...this._pendingSessionDisposals,
        ];
        const pendingLoadCompletion = this._loadCompletion;
        this._sceneSessions.clear();
        this._activeSceneSession = null;
        this._listeners.clear();

        let resolveDispose;
        let rejectDispose;
        this._disposePromise = new Promise((resolve, reject) => {
            resolveDispose = resolve;
            rejectDispose = reject;
        });

        const errors = [];
        const releaseOperations = [];
        for (const [session, assetScope] of sessions) {
            try {
                session.Scene.Dispose();
            } catch (error) {
                errors.push(error);
            }
            if (assetScope) {
                releaseOperations.push(
                    this._ReleaseAssetScope(
                        assetScope,
                        "Scene manager assets failed to release.",
                        true,
                    ).catch((error) => errors.push(error)),
                );
            }
        }

        Promise.all([...releaseOperations, ...pendingSessionDisposals])
            .then(() => pendingLoadCompletion)
            .then(() => {
                if (errors.length > 0) {
                    throw new AggregateError(
                        errors,
                        "Scene manager disposal failed.",
                    );
                }
            })
            .then(resolveDispose, rejectDispose);

        return this._disposePromise;
    }

    async _LoadCandidate(sourceUrl, loadCandidate) {
        this._RequireNotDisposed();

        if (this._isLoading) {
            throw new Error("A scene load is already in progress.");
        }

        this._isLoading = true;
        let resolveLoadCompletion;
        this._loadCompletion = new Promise((resolve) => {
            resolveLoadCompletion = resolve;
        });

        let pendingScene = null;
        let pendingAssetScope = null;

        try {
            pendingAssetScope = this._CreateAssetScope();

            const sceneLoadOptions = this._CreateSceneLoadOptions(
                sourceUrl,
                pendingAssetScope,
            );

            pendingScene = await loadCandidate(sceneLoadOptions);

            this._RequireNotDisposed();

            if (!IsSceneCandidate(pendingScene)) {
                throw new TypeError(
                    "Scene loader returned an invalid scene.",
                );
            }

            const existingSession = [...this._sceneSessions.keys()].find(
                (session) => session.Scene === pendingScene,
            );
            if (existingSession) {
                pendingScene = null;
                return existingSession;
            }

            const session = Object.freeze({
                Scene: pendingScene,
                Url: sourceUrl,
            });
            this._sceneSessions.set(session, pendingAssetScope);
            pendingScene = null;
            pendingAssetScope = null;
            return session;
        } finally {
            try {
                this._DisposeUnactivatedScene(pendingScene);

                await this._ReleaseAssetScope(
                    pendingAssetScope,
                    "Unactivated scene assets failed to release.",
                );
            } finally {
                this._isLoading = false;
                resolveLoadCompletion();
                this._loadCompletion = null;
            }
        }
    }

    _CreateSceneLoadOptions(url, assetScope) {
        const loadOptions = this._createLoadOptions(url, assetScope);

        if (
            !loadOptions ||
            typeof loadOptions !== "object" ||
            Array.isArray(loadOptions)
        ) {
            throw new TypeError(
                "Scene load options must be an object.",
            );
        }

        return assetScope
            ? { ...loadOptions, assetScope }
            : loadOptions;
    }

    _CreateAssetScope() {
        if (!this._createAssetScope) {
            return null;
        }

        const assetScope = this._createAssetScope();

        if (
            !assetScope ||
            typeof assetScope.Acquire !== "function" ||
            typeof assetScope.ReleaseAll !== "function"
        ) {
            throw new TypeError(
                "Asset scope factory returned an invalid scope.",
            );
        }

        return assetScope;
    }

    _DisposeUnactivatedScene(scene) {
        if (!scene) {
            return;
        }

        try {
            if (typeof scene.Dispose === "function") {
                scene.Dispose();
            }
        } catch (error) {
            AstralLogger.Error(
                "Unactivated scene cleanup failed.",
                error,
            );
        }
    }

    async _ReleaseAssetScope(assetScope, message, throwOnError = false) {
        if (!assetScope) {
            return;
        }

        try {
            await assetScope.ReleaseAll();
        } catch (error) {
            AstralLogger.Error(message, error);
            if (throwOnError) {
                throw error;
            }
        }
    }

    _Notify(change) {
        for (const listener of [...this._listeners]) {
            try {
                listener(this, change);
            } catch (error) {
                AstralLogger.Error(
                    "Scene manager listener failed.",
                    error,
                );
            }
        }
    }

    _RequireNotDisposed() {
        if (this._isDisposed) {
            throw new Error("SceneManager has been disposed.");
        }
    }
}
