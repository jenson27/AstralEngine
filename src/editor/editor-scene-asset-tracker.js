import { AstralLogger } from "../diagnostics/logger.js";

function HaveSameAssetIds(left, right) {
    return (
        left?.length === right.length &&
        left.every((assetId, index) => assetId === right[index])
    );
}

export class EditorSceneAssetTracker {
    constructor({ sceneManager, history, componentCatalog }) {
        if (
            !sceneManager ||
            typeof sceneManager.RetainActiveAssetHandles !== "function" ||
            !history ||
            typeof history.GetRetainedAssetIds !== "function" ||
            typeof history.Subscribe !== "function" ||
            !componentCatalog ||
            typeof componentCatalog.GetAssetIds !== "function"
        ) {
            throw new TypeError(
                "Editor scene asset tracking requires scene, history, and component catalog services.",
            );
        }

        this._sceneManager = sceneManager;
        this._history = history;
        this._componentCatalog = componentCatalog;
        this._lastScene = null;
        this._lastAssetIds = null;
        this._refreshPromise = null;
        this._refreshRequested = false;
        this._forceRefreshRequested = false;
        this._isDisposed = false;
        this._unsubscribeHistory = history.Subscribe(() => {
            void this.Refresh();
        });
        void this.Refresh();
    }

    Refresh({ force = false } = {}) {
        if (force) {
            this._forceRefreshRequested = true;
        }
        if (this._isDisposed || this._history.IsBusy) {
            return Promise.resolve(false);
        }
        if (this._refreshPromise) {
            this._refreshRequested = true;
            return this._refreshPromise;
        }

        this._refreshPromise = this._DrainRefreshRequests().finally(() => {
            this._refreshPromise = null;
            if (this._refreshRequested && !this._isDisposed) {
                void this.Refresh();
            }
        });
        return this._refreshPromise;
    }

    Dispose() {
        if (this._isDisposed) {
            return;
        }
        this._isDisposed = true;
        this._unsubscribeHistory?.();
    }

    async _DrainRefreshRequests() {
        let didRetain = false;
        do {
            this._refreshRequested = false;
            const force = this._forceRefreshRequested;
            this._forceRefreshRequested = false;
            didRetain = (await this._RefreshOnce(force)) || didRetain;
        } while (
            (this._refreshRequested || this._forceRefreshRequested) &&
            !this._isDisposed
        );
        return didRetain;
    }

    async _RefreshOnce(force = false) {
        const scene = this._sceneManager.ActiveScene;
        if (!scene) {
            this._lastScene = null;
            this._lastAssetIds = null;
            return false;
        }
        if (this._history.IsBusy || this._isDisposed) {
            return false;
        }

        try {
            const assetIds = [
                ...new Set([
                    ...this._componentCatalog.GetAssetIds(scene),
                    ...this._history.GetRetainedAssetIds(),
                ]),
            ].sort();
            if (
                !force &&
                this._lastScene === scene &&
                HaveSameAssetIds(this._lastAssetIds, assetIds)
            ) {
                return true;
            }

            const retained = await this._sceneManager.RetainActiveAssetHandles(
                scene,
                assetIds,
            );
            if (!retained) {
                return false;
            }

            this._lastScene = scene;
            this._lastAssetIds = assetIds;
            return true;
        } catch (error) {
            AstralLogger.Warn(
                "Editor scene asset retention refresh failed.",
                error,
            );
            return false;
        }
    }
}
