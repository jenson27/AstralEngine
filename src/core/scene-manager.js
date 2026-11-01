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
    constructor(sceneLoader, createLoadOptions = () => ({})) {
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

        this._sceneLoader = sceneLoader;
        this._createLoadOptions = createLoadOptions;
        this._activeScene = null;
        this._isLoading = false;
        this._isDisposed = false;
    }

    get ActiveScene() {
        return this._activeScene;
    }

    async LoadScene(url) {
        this._RequireNotDisposed();

        if (this._isLoading) {
            throw new Error("A scene load is already in progress.");
        }

        this._isLoading = true;
        let pendingScene = null;

        try {
            const loadOptions = this._createLoadOptions(url);
            pendingScene = await this._sceneLoader.Load(url, loadOptions);

            this._RequireNotDisposed();

            const previousScene = this._activeScene;

            if (!IsSceneCandidate(pendingScene)) {
                throw new TypeError("Scene loader returned an invalid scene.");
            }

            if (pendingScene === previousScene) {
                pendingScene = null;
                return previousScene;
            }

            this._activeScene = pendingScene;
            pendingScene = null;

            this._DisposePreviousScene(previousScene);
            return this._activeScene;
        } finally {
            this._isLoading = false;
            this._DisposeUnactivatedScene(pendingScene);
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
        if (this._isDisposed) {
            return;
        }

        this._isDisposed = true;

        const activeScene = this._activeScene;
        this._activeScene = null;
        activeScene?.Dispose();
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
            AstralLogger.Error("Unactivated scene cleanup failed.", error);
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
