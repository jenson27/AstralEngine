import { AstralLogger } from "../../../diagnostics/logger.js";
import { GetAssetFileUrl } from "./asset-browser-model.js";
import { AssetBrowserView } from "./asset-browser-view.js";

const API_FORMAT = "astral-asset-directory";
const API_VERSION = 1;

function ValidateAssetDirectoryData(data, expectedPath) {
    if (
        data?.format !== API_FORMAT ||
        data.version !== API_VERSION ||
        data.path !== expectedPath ||
        !Array.isArray(data.entries)
    ) {
        throw new Error(
            "Asset directory response is not valid version 1 data.",
        );
    }

    return data.entries;
}

export class AssetBrowserPanel {
    constructor(
        rootElement,
        {
            logger = AstralLogger,
            fetcher = globalThis.fetch?.bind(globalThis),
            getAssetCatalog = () => null,
        } = {},
    ) {
        if (!(rootElement instanceof HTMLElement)) {
            throw new TypeError("AssetBrowserPanel requires a root element.");
        }
        if (typeof fetcher !== "function") {
            throw new TypeError("AssetBrowserPanel requires a fetch function.");
        }
        if (typeof getAssetCatalog !== "function") {
            throw new TypeError(
                "AssetBrowserPanel requires an asset catalog getter.",
            );
        }

        this._logger = logger;
        this._fetcher = fetcher;
        this._getAssetCatalog = getAssetCatalog;
        this._currentPath = "";
        this._entries = [];
        this._selectedRelativePath = null;
        this._requestRevision = 0;
        this._isLoading = true;
        this._loadFailed = false;
        this._isDisposed = false;
        this._view = new AssetBrowserView(rootElement, {
            onRefresh: () => void this.Refresh(),
            onNavigate: (path) => this._NavigateTo(path),
            onSelect: (path) => this._SelectFile(path),
            getCatalogAssetIds: (path) => this._GetCatalogAssetIds(path),
            getBuiltInAssets: () => this._GetBuiltInAssets(),
        });
    }

    OnShow() {
        void this.Refresh();
    }

    Dispose() {
        if (this._isDisposed) {
            return;
        }

        this._isDisposed = true;
        this._requestRevision += 1;
        this._view.Dispose();
    }

    async Refresh() {
        if (this._isDisposed) {
            return;
        }

        const requestRevision = ++this._requestRevision;
        this._isLoading = true;
        this._loadFailed = false;
        this._view.SetRefreshDisabled(true);
        this._view.SetStatus("Loading asset files…");
        this._view.SetEntryState(this._GetEntryViewState());
        if (this._entries.length === 0) {
            this._RenderEntries();
        }

        try {
            const entries = await this._FetchEntries(this._currentPath);
            if (!this._IsCurrentRequest(requestRevision)) {
                return;
            }

            this._ApplyEntries(entries);
        } catch (error) {
            if (!this._IsCurrentRequest(requestRevision)) {
                return;
            }

            this._HandleRefreshError(error);
        } finally {
            if (this._IsCurrentRequest(requestRevision)) {
                this._view.SetRefreshDisabled(false);
            }
        }
    }

    async _FetchEntries(path) {
        const query = new URLSearchParams({ path });
        const response = await this._fetcher(
            "/api/assets?" + query.toString(),
            { cache: "no-store" },
        );
        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data?.error?.message ??
                    "Could not read assets. HTTP " + response.status + ".",
            );
        }
        return ValidateAssetDirectoryData(data, path);
    }

    _IsCurrentRequest(requestRevision) {
        return (
            !this._isDisposed &&
            requestRevision === this._requestRevision
        );
    }

    _ApplyEntries(entries) {
        this._entries = entries;
        this._isLoading = false;
        this._loadFailed = false;
        if (
            this._selectedRelativePath &&
            !this._entries.some(
                (entry) =>
                    entry.relativePath === this._selectedRelativePath &&
                    entry.kind === "file",
            )
        ) {
            this._selectedRelativePath = null;
        }

        this._RenderEntries();
        this._RenderDetails();
    }

    _HandleRefreshError(error) {
        this._entries = [];
        this._selectedRelativePath = null;
        this._isLoading = false;
        this._loadFailed = true;
        const message = error instanceof Error ? error.message : String(error);
        this._view.SetStatus("Could not load assets: " + message, "error");
        this._RenderEntries();
        this._RenderDetails();
        this._logger?.Warn("Asset browser refresh failed.", error);
    }

    _NavigateTo(path) {
        if (this._isDisposed) {
            return;
        }

        this._currentPath = path;
        this._entries = [];
        this._selectedRelativePath = null;
        this._loadFailed = false;
        this._view.RenderBreadcrumbs(this._currentPath);
        this._RenderEntries();
        this._RenderDetails();
        void this.Refresh();
    }

    _SelectFile(path) {
        if (this._isDisposed) {
            return;
        }

        this._selectedRelativePath = path;
        this._RenderEntries();
        this._RenderDetails();
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

    _GetBuiltInAssets() {
        const assetCatalog = this._getAssetCatalog();
        if (typeof assetCatalog?.GetAll !== "function") {
            return [];
        }

        return assetCatalog
            .GetAll()
            .filter((asset) => asset.id.startsWith("builtin:"));
    }

    _GetEntryViewState() {
        return {
            entries: this._entries,
            selectedRelativePath: this._selectedRelativePath,
            isLoading: this._isLoading,
            loadFailed: this._loadFailed,
        };
    }

    _RenderEntries() {
        this._view.RenderEntries(this._GetEntryViewState());
    }

    _RenderDetails() {
        this._view.RenderDetails({
            entries: this._entries,
            selectedRelativePath: this._selectedRelativePath,
        });
    }
}
