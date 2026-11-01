import { AstralLogger } from "../diagnostics/logger.js";
import { AssetCatalog } from "./assets/asset-catalog.js";
import { AssetManager } from "./assets/asset-manager.js";

export class HotReloadClient {
    constructor(
        assetRuntime,
        sceneManager,
        {
            EventSourceClass = globalThis.EventSource,
            fetchFunction = globalThis.fetch?.bind(globalThis),
            endpoint = "/api/hot-reload",
            manifestUrl = "/assets/asset-manifest.json",
            logger = AstralLogger,
        } = {},
    ) {
        if (
            !assetRuntime ||
            !assetRuntime.catalog ||
            typeof assetRuntime.catalog.GetAssetIdsBySourcePath !== "function" ||
            !assetRuntime.loaderRegistry ||
            typeof assetRuntime.loaderRegistry.GetRequired !== "function"
        ) {
            throw new TypeError(
                "Hot-reload client requires an asset runtime.",
            );
        }

        if (
            !assetRuntime.manager ||
            typeof assetRuntime.manager.StageReload !== "function" ||
            typeof assetRuntime.manager.CommitStagedReload !== "function" ||
            typeof assetRuntime.manager.GetState !== "function"
        ) {
            throw new TypeError(
                "Hot-reload client requires a reload-capable asset manager.",
            );
        }

        if (!sceneManager || typeof sceneManager.LoadScene !== "function") {
            throw new TypeError(
                "Hot-reload client requires a scene manager.",
            );
        }

        if (typeof endpoint !== "string" || endpoint.trim() === "") {
            throw new TypeError(
                "Hot-reload endpoint must be a non-empty string.",
            );
        }

        if (typeof fetchFunction !== "function") {
            throw new TypeError("Hot-reload client requires fetch.");
        }

        if (typeof manifestUrl !== "string" || manifestUrl.trim() === "") {
            throw new TypeError("Manifest URL must be a non-empty string.");
        }

        if (!logger || typeof logger.Error !== "function") {
            throw new TypeError("Hot-reload client requires a logger.");
        }

        this._assetRuntime = assetRuntime;
        this._sceneManager = sceneManager;
        this._EventSourceClass = EventSourceClass;
        this._fetchFunction = fetchFunction;
        this._endpoint = endpoint;
        this._manifestUrl = manifestUrl;
        this._logger = logger;
        this._eventSource = null;
        this._pendingAssetIds = new Set();
        this._pendingSceneUrls = new Set();
        this._pendingManifestReload = false;
        this._isReloadBusy = false;
        this._isManifestReloading = false;
        this._isReloadReady = false;
        this._isDisposed = false;
        this._hasReportedConnectionError = false;
        this._hasConnectedBefore = false;
    }

    Connect() {
        if (this._eventSource) {
            return false;
        }

        if (typeof this._EventSourceClass !== "function") {
            this._logger.Warn?.(
                "Hot reload is unavailable because EventSource is not supported.",
            );
            return false;
        }

        try {
            this._eventSource = new this._EventSourceClass(
                this._endpoint,
            );
        } catch (error) {
            this._logger.Error(
                "Could not connect to the hot-reload stream.",
                error,
            );
            return false;
        }

        this._eventSource.addEventListener(
            "asset-change",
            (event) => this._HandleAssetChange(event),
        );
        this._eventSource.addEventListener("open", () => {
            const isReconnect = this._hasConnectedBefore;
            this._hasConnectedBefore = true;
            this._hasReportedConnectionError = false;

            if (isReconnect) {
                this._QueueManifestReload();
            }
        });
        this._eventSource.addEventListener("error", () => {
            if (this._hasReportedConnectionError) {
                return;
            }

            this._hasReportedConnectionError = true;
            this._logger.Warn?.(
                "Hot-reload stream disconnected. The browser will retry.",
            );
        });

        return true;
    }

    CommitAtFrameBoundary() {
        if (!this._isReloadReady) {
            return false;
        }

        this._isReloadReady = false;

        let cleanupPromise;

        try {
            cleanupPromise = this._assetRuntime.manager.CommitStagedReload();
        } catch (error) {
            this._logger.Error(
                "Could not commit staged asset reload.",
                error,
            );
            this._isReloadBusy = false;
            this._ProcessPendingReloads();
            return false;
        }

        if (!cleanupPromise) {
            this._isReloadBusy = false;
            this._ProcessPendingReloads();
            return false;
        }

        Promise.resolve(cleanupPromise)
            .then((result) => {
                this._logger.Info?.("Assets hot reloaded.", {
                    assetIds: result.assetIds,
                });
            })
            .catch((error) => {
                this._logger.Error(
                    "Asset reload committed, but cleanup failed.",
                    error,
                );
            })
            .finally(() => {
                this._isReloadBusy = false;
                this._ProcessPendingReloads();
            });

        return true;
    }

    Dispose() {
        if (this._isDisposed) {
            return;
        }

        this._isDisposed = true;
        this._pendingAssetIds.clear();
        this._pendingSceneUrls.clear();
        this._pendingManifestReload = false;
        this._eventSource?.close();
        this._eventSource = null;

        if (this._isReloadReady) {
            this.CommitAtFrameBoundary();
        }
    }

    _HandleAssetChange(event) {
        let message;

        try {
            message = JSON.parse(event.data);
        } catch (error) {
            this._logger.Warn?.(
                "Ignored an invalid hot-reload event.",
                error,
            );
            return;
        }

        if (!message || typeof message !== "object") {
            return;
        }

        if (message.rescan === true) {
            this._QueueManifestReload();
            return;
        }

        if (!Array.isArray(message.paths)) {
            return;
        }

        if (
            this._pendingManifestReload ||
            this._isManifestReloading ||
            message.paths.some((sourcePath) =>
                this._IsManifestPath(sourcePath),
            )
        ) {
            this._QueueManifestReload();
            return;
        }

        for (const sourcePath of message.paths) {
            if (this._IsActiveScenePath(sourcePath)) {
                this._pendingSceneUrls.add(
                    this._sceneManager.ActiveSceneUrl,
                );
                continue;
            }

            const assetIds =
                this._assetRuntime.catalog.GetAssetIdsBySourcePath(
                    sourcePath,
                );

            for (const assetId of assetIds) {
                const state = this._assetRuntime.manager.GetState(assetId);

                if (state === "loaded" || state === "loading") {
                    this._pendingAssetIds.add(assetId);
                }
            }
        }

        this._ProcessPendingReloads();
    }

    _ProcessPendingReloads() {
        if (this._isDisposed || this._isReloadBusy) {
            return;
        }

        if (this._pendingManifestReload) {
            this._pendingManifestReload = false;
            void this._ReloadPendingManifest();
            return;
        }

        if (this._pendingAssetIds.size > 0) {
            this._StagePendingAssets();
            return;
        }

        this._ReloadPendingScene();
    }

    _StagePendingAssets() {
        const assetIds = Array.from(this._pendingAssetIds);
        this._pendingAssetIds.clear();
        this._isReloadBusy = true;

        this._assetRuntime.manager
            .StageReload(assetIds)
            .then((result) => {
                this._isReloadReady = true;
                this._logger.Info?.("Asset reload staged.", {
                    assetIds: result.affectedAssetIds,
                });

                if (this._isDisposed) {
                    this.CommitAtFrameBoundary();
                }
            })
            .catch((error) => {
                this._logger.Error(
                    "Asset reload staging failed. Current assets remain active.",
                    error,
                );
                this._isReloadBusy = false;
                this._ProcessPendingReloads();
            });
    }

    _QueueManifestReload() {
        this._pendingManifestReload = true;
        this._pendingAssetIds.clear();
        this._pendingSceneUrls.clear();
        this._ProcessPendingReloads();
    }

    async _ReloadPendingManifest() {
        const sceneUrl = this._sceneManager.ActiveSceneUrl;

        if (!sceneUrl) {
            return;
        }

        const previousScene = this._sceneManager.ActiveScene;
        const previousCatalog = this._assetRuntime.catalog;
        const previousManager = this._assetRuntime.manager;
        let candidateRuntimeActive = false;
        this._isReloadBusy = true;
        this._isManifestReloading = true;

        try {
            const response = await this._fetchFunction(
                this._manifestUrl,
                { cache: "no-store" },
            );

            if (!response?.ok) {
                throw new Error(
                    `Could not fetch asset manifest. HTTP ${response?.status ?? "unknown"}.`,
                );
            }

            const candidateCatalog = new AssetCatalog();
            candidateCatalog.RegisterManifest(await response.json());
            const candidateManager = new AssetManager(
                candidateCatalog,
                this._assetRuntime.loaderRegistry,
            );

            this._assetRuntime.catalog = candidateCatalog;
            this._assetRuntime.manager = candidateManager;
            candidateRuntimeActive = true;

            try {
                await this._sceneManager.LoadScene(sceneUrl);
            } catch (error) {
                if (this._sceneManager.ActiveScene === previousScene) {
                    this._assetRuntime.catalog = previousCatalog;
                    this._assetRuntime.manager = previousManager;
                    candidateRuntimeActive = false;
                    throw error;
                }

                this._logger.Error(
                    "Manifest reload switched scenes, but previous scene cleanup failed.",
                    error,
                );
            }

            if (this._sceneManager.ActiveScene === previousScene) {
                this._assetRuntime.catalog = previousCatalog;
                this._assetRuntime.manager = previousManager;
                candidateRuntimeActive = false;
                throw new Error(
                    "Manifest reload did not replace the active scene.",
                );
            }

            this._logger.Info?.("Asset manifest hot reloaded.", {
                sceneUrl,
            });
        } catch (error) {
            if (
                candidateRuntimeActive &&
                this._sceneManager.ActiveScene === previousScene
            ) {
                this._assetRuntime.catalog = previousCatalog;
                this._assetRuntime.manager = previousManager;
            }

            this._logger.Error(
                "Manifest hot reload failed. The current asset runtime remains active.",
                error,
            );
        } finally {
            this._isManifestReloading = false;
            this._isReloadBusy = false;
            this._ProcessPendingReloads();
        }
    }

    _ReloadPendingScene() {
        const activeSceneUrl = this._sceneManager.ActiveSceneUrl;

        if (!activeSceneUrl) {
            this._pendingSceneUrls.clear();
            return;
        }

        const sceneUrl = Array.from(this._pendingSceneUrls).find(
            (url) => this._NormalizePath(url) === this._NormalizePath(activeSceneUrl),
        );

        this._pendingSceneUrls.clear();

        if (!sceneUrl) {
            return;
        }

        this._isReloadBusy = true;

        this._sceneManager
            .LoadScene(sceneUrl)
            .then((scene) => {
                this._logger.Info?.("Scene hot reloaded.", {
                    sceneName: scene?.Name,
                    sceneUrl,
                });
            })
            .catch((error) => {
                this._logger.Error(
                    "Scene hot reload failed. The active scene remains loaded.",
                    error,
                );
            })
            .finally(() => {
                this._isReloadBusy = false;
                this._ProcessPendingReloads();
            });
    }

    _IsActiveScenePath(sourcePath) {
        const activeSceneUrl = this._sceneManager.ActiveSceneUrl;

        return (
            typeof sourcePath === "string" &&
            activeSceneUrl !== null &&
            this._NormalizePath(sourcePath) ===
                this._NormalizePath(activeSceneUrl)
        );
    }

    _IsManifestPath(sourcePath) {
        return (
            typeof sourcePath === "string" &&
            this._NormalizePath(sourcePath) ===
                this._NormalizePath(this._manifestUrl)
        );
    }

    _NormalizePath(sourcePath) {
        try {
            return new URL(
                sourcePath,
                "http://astral-engine.local",
            ).pathname;
        } catch {
            return "";
        }
    }
}
