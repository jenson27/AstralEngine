import { AstralLogger } from "../diagnostics/logger.js";

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
        this._activeScene = null;
        this._activeSceneUrl = null;
        this._activeAssetScope = null;
        this._isLoading = false;
        this._loadCompletion = null;
        this._isDisposed = false;
        this._disposePromise = null;
    }

    get ActiveScene() {
        return this._activeScene;
    }

    get ActiveSceneUrl() {
        return this._activeSceneUrl;
    }

    async LoadScene(url) {
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

            const loadOptions = this._createLoadOptions(
                url,
                pendingAssetScope,
            );

            if (
                !loadOptions ||
                typeof loadOptions !== "object" ||
                Array.isArray(loadOptions)
            ) {
                throw new TypeError(
                    "Scene load options must be an object.",
                );
            }

            const sceneLoadOptions = pendingAssetScope
                ? { ...loadOptions, assetScope: pendingAssetScope }
                : loadOptions;

            pendingScene = await this._sceneLoader.Load(
                url,
                sceneLoadOptions,
            );

            this._RequireNotDisposed();

            const previousScene = this._activeScene;

            if (!IsSceneCandidate(pendingScene)) {
                throw new TypeError(
                    "Scene loader returned an invalid scene.",
                );
            }

            if (pendingScene === previousScene) {
                pendingScene = null;
                return previousScene;
            }

            const previousAssetScope = this._activeAssetScope;

            this._activeScene = pendingScene;
            this._activeSceneUrl = url;
            this._activeAssetScope = pendingAssetScope;
            pendingScene = null;
            pendingAssetScope = null;

            this._DisposePreviousScene(previousScene);
            await this._ReleaseAssetScope(
                previousAssetScope,
                "Previous scene assets failed to release.",
            );

            this._RequireNotDisposed();
            return this._activeScene;
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

    FixedUpdate(deltaTime, elapsedTime) {
        this._RequireActiveScene().FixedUpdate(deltaTime, elapsedTime);
    }

    PrepareRender(interpolationAlpha, aspectRatio) {
        this._RequireActiveScene().PrepareRender(
            interpolationAlpha,
            aspectRatio,
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

        const activeScene = this._activeScene;
        const activeAssetScope = this._activeAssetScope;
        const pendingLoadCompletion = this._loadCompletion;

        this._activeScene = null;
        this._activeSceneUrl = null;
        this._activeAssetScope = null;

        let resolveDispose;
        let rejectDispose;

        this._disposePromise = new Promise((resolve, reject) => {
            resolveDispose = resolve;
            rejectDispose = reject;
        });

        const errors = [];

        try {
            activeScene?.Dispose();
        } catch (error) {
            errors.push(error);
        }

        Promise.resolve()
            .then(async () => {
                try {
                    await activeAssetScope?.ReleaseAll();
                } catch (error) {
                    errors.push(error);
                }

                await pendingLoadCompletion;

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

    _DisposePreviousScene(scene) {
        try {
            scene?.Dispose();
        } catch (error) {
            AstralLogger.Error(
                "Previous scene failed to dispose after scene replacement.",
                error,
            );
        }
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

    async _ReleaseAssetScope(assetScope, message) {
        if (!assetScope) {
            return;
        }

        try {
            await assetScope.ReleaseAll();
        } catch (error) {
            AstralLogger.Error(message, error);
        }
    }

    _RequireActiveScene() {
        this._RequireNotDisposed();

        if (!this._activeScene) {
            throw new Error("SceneManager has no active scene.");
        }

        return this._activeScene;
    }

    _RequireNotDisposed() {
        if (this._isDisposed) {
            throw new Error("SceneManager has been disposed.");
        }
    }
}
