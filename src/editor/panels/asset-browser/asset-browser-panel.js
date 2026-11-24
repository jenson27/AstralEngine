import { AstralLogger } from "../../../diagnostics/logger.js";
import { GetAssetFileUrl } from "./asset-browser-model.js";
import { AssetBrowserDirectoryState } from "./asset-browser-directory-state.js";
import { AssetBrowserView } from "./asset-browser-view.js";

export class AssetBrowserPanel {
    constructor(
        rootElement,
        {
            logger = AstralLogger,
            fetcher = globalThis.fetch?.bind(globalThis),
            getAssetCatalog = () => null,
            onOpenScene = () => {},
        } = {},
    ) {
        if (!(rootElement instanceof HTMLElement)) {
            throw new TypeError("AssetBrowserPanel requires a root element.");
        }
        if (typeof getAssetCatalog !== "function") {
            throw new TypeError(
                "AssetBrowserPanel requires an asset catalog getter.",
            );
        }
        if (typeof onOpenScene !== "function") {
            throw new TypeError(
                "AssetBrowserPanel scene opener must be a function.",
            );
        }

        this._logger = logger;
        this._getAssetCatalog = getAssetCatalog;
        this._refreshRevision = 0;
        this._statusMessage = "";
        this._statusState = "";
        this._isDisposed = false;
        this._view = new AssetBrowserView(rootElement, {
            onRefresh: () => void this.Refresh(),
            onSelectDirectory: (path) => this._SelectDirectory(path),
            onToggleDirectory: (path) => this._ToggleDirectory(path),
            onSelect: (path) => this._SelectFile(path),
            onSelectGridDirectory: (path) =>
                this._SelectGridDirectory(path),
            onOpenDirectory: (path) => this._SelectDirectory(path),
            onOpenScene,
            onRetryDirectory: (path) => void this._RetryDirectory(path),
            getCatalogAssetIds: (path) => this._GetCatalogAssetIds(path),
        });
        this._directoryState = new AssetBrowserDirectoryState({
            fetcher,
            logger,
            onChange: (reason) => {
                if (reason === "selection") {
                    this._RenderSelection();
                    return;
                }
                if (reason === "tree") {
                    this._RenderTree();
                    return;
                }
                this._Render();
            },
        });
        this._Render();
    }

    OnShow() {
        void this.Refresh();
    }

    Dispose() {
        if (this._isDisposed) {
            return;
        }

        this._isDisposed = true;
        this._refreshRevision += 1;
        this._directoryState.Dispose();
        this._view.Dispose();
    }

    async Refresh() {
        if (this._isDisposed) {
            return;
        }

        const refreshRevision = ++this._refreshRevision;
        this._statusMessage = "Refreshing assets…";
        this._statusState = "";
        this._view.SetRefreshDisabled(true);
        this._view.SetStatus(this._statusMessage, this._statusState);

        try {
            const result = await this._directoryState.Refresh();
            if (!this._IsCurrentRefresh(refreshRevision)) {
                return;
            }
            if (!result.ok) {
                if (result.stale) {
                    return;
                }
                this._statusMessage =
                    "Could not load Assets: " +
                    (result.error?.message ?? "The request failed.");
                this._statusState = "error";
                this._Render();
                return;
            }

            this._statusMessage = "";
            this._statusState = "";
            this._Render();
        } catch (error) {
            if (!this._IsCurrentRefresh(refreshRevision)) {
                return;
            }

            this._statusMessage = "Could not refresh assets: " + error.message;
            this._statusState = "error";
            this._logger?.Warn("Asset browser refresh failed.", error);
            this._Render();
        } finally {
            if (this._IsCurrentRefresh(refreshRevision)) {
                this._view.SetRefreshDisabled(false);
            }
        }
    }

    _IsCurrentRefresh(refreshRevision) {
        return (
            !this._isDisposed &&
            refreshRevision === this._refreshRevision
        );
    }

    _SelectDirectory(path) {
        if (this._isDisposed) {
            return;
        }
        this._statusMessage = "";
        this._statusState = "";
        void this._directoryState.SelectDirectory(path);
    }

    _SelectFile(path) {
        this._directoryState.SelectFile(path);
    }

    _SelectGridDirectory(path) {
        this._directoryState.SelectGridDirectory(path);
    }

    _ToggleDirectory(path) {
        if (this._isDisposed) {
            return;
        }
        this._statusMessage = "";
        this._statusState = "";
        this._view.SetStatus(this._statusMessage, this._statusState);
        void this._directoryState.ToggleDirectory(path);
    }

    async _RetryDirectory(path) {
        if (this._isDisposed) {
            return;
        }
        this._statusMessage = "";
        this._statusState = "";
        await this._directoryState.RetryDirectory(path);
    }

    _GetCatalogAssetIds(relativePath) {
        const assetCatalog = this._getAssetCatalog();
        if (typeof assetCatalog?.GetAssetIdsBySourcePath !== "function") {
            return [];
        }

        return assetCatalog.GetAssetIdsBySourcePath(
            GetAssetFileUrl(relativePath),
        );
    }

    _GetViewState() {
        return {
            ...this._directoryState.GetSnapshot(),
            statusMessage: this._statusMessage,
            statusState: this._statusState,
        };
    }

    _Render() {
        if (this._view) {
            this._view.Render(this._GetViewState());
        }
    }

    _RenderSelection() {
        if (this._view) {
            this._view.RenderSelection(this._GetViewState());
        }
    }

    _RenderTree() {
        if (this._view) {
            this._view.RenderTree(this._GetViewState());
        }
    }
}
