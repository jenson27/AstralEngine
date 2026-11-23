import { AstralLogger } from "../../../diagnostics/logger.js";

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

function GetParentPath(relativePath) {
    const separatorIndex = relativePath.lastIndexOf("/");
    return separatorIndex < 0 ? "" : relativePath.slice(0, separatorIndex);
}

function IsPathWithinDirectory(relativePath, directoryPath) {
    return (
        relativePath === directoryPath ||
        directoryPath === "" ||
        relativePath.startsWith(directoryPath + "/")
    );
}

function GetPathDepth(relativePath) {
    return relativePath ? relativePath.split("/").length : 0;
}

function CreateAssetDirectoryError(message, statusCode) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

export class AssetBrowserDirectoryState {
    constructor({
        fetcher = globalThis.fetch?.bind(globalThis),
        logger = AstralLogger,
        onChange = () => {},
    } = {}) {
        if (typeof fetcher !== "function") {
            throw new TypeError(
                "AssetBrowserDirectoryState requires a fetch function.",
            );
        }
        if (typeof onChange !== "function") {
            throw new TypeError(
                "AssetBrowserDirectoryState requires a change callback.",
            );
        }

        this._fetcher = fetcher;
        this._logger = logger;
        this._onChange = onChange;
        this._directoryEntries = new Map();
        this._expandedPaths = new Set([""]);
        this._loadingPaths = new Map();
        this._directoryErrors = new Map();
        this._directoryRequests = new Map();
        this._directoryLoadTokens = new Map();
        this._nextDirectoryLoadToken = 0;
        this._currentPath = "";
        this._selectedRelativePath = null;
        this._selectedGridDirectoryPath = null;
        this._requestRevision = 0;
        this._isDisposed = false;
    }

    GetSnapshot() {
        const loadError = this._GetErrorForPath(this._currentPath);
        return {
            currentPath: this._currentPath,
            entries: (this._directoryEntries.get(this._currentPath) ?? [])
                .map((entry) => ({ ...entry })),
            directoryTree: this._CreateDirectoryTreeSnapshot("", "Assets"),
            selectedRelativePath: this._selectedRelativePath,
            selectedGridDirectoryPath: this._selectedGridDirectoryPath,
            isLoading: this._loadingPaths.has(this._currentPath),
            loadFailed: Boolean(loadError),
            loadError,
        };
    }

    async Refresh() {
        if (this._isDisposed) {
            return { ok: false, stale: true };
        }

        const requestRevision = ++this._requestRevision;
        const rootResult = await this._LoadDirectory(
            "",
            requestRevision,
            true,
        );
        if (!this._IsCurrentRequest(requestRevision)) {
            return { ok: false, stale: true };
        }
        if (!rootResult.ok) {
            this._NotifyChange("refresh");
            return rootResult;
        }

        const pathsToRefresh = new Set(
            [...this._expandedPaths].filter(Boolean),
        );
        if (this._currentPath) {
            pathsToRefresh.add(this._currentPath);
        }

        const result = await this._RefreshPaths(
            [...pathsToRefresh],
            requestRevision,
        );
        if (!this._IsCurrentRequest(requestRevision)) {
            return { ok: false, stale: true };
        }

        this._ValidateSelection();
        this._NotifyChange("refresh");
        return result;
    }

    async SelectDirectory(path) {
        if (this._isDisposed) {
            return { ok: false, stale: true };
        }

        this._currentPath = path;
        this._selectedRelativePath = null;
        this._selectedGridDirectoryPath = null;
        this._ExpandDirectoryAncestors(path);
        if (this._directoryEntries.has(path)) {
            this._NotifyChange("directory");
            return { ok: true };
        }

        const requestRevision = this._requestRevision;
        const load = this._LoadDirectory(path, requestRevision);
        this._NotifyChange("directory");
        const result = await load;
        if (this._IsCurrentRequest(requestRevision)) {
            this._NotifyChange("directory");
        }
        return result;
    }

    async ToggleDirectory(path) {
        if (this._isDisposed) {
            return { ok: false, stale: true };
        }

        if (this._expandedPaths.has(path)) {
            this._expandedPaths.delete(path);
            this._NotifyChange("tree");
            return { ok: true };
        }

        this._expandedPaths.add(path);
        if (
            this._directoryEntries.has(path) &&
            !this._directoryErrors.has(path)
        ) {
            this._NotifyChange("tree");
            return { ok: true };
        }

        const requestRevision = this._requestRevision;
        const load = this._LoadDirectory(
            path,
            requestRevision,
            this._directoryErrors.has(path),
        );
        this._NotifyChange("tree");
        const result = await load;
        if (this._IsCurrentRequest(requestRevision)) {
            this._NotifyChange("tree");
        }
        return result;
    }

    SelectFile(path) {
        if (this._isDisposed) {
            return;
        }
        this._selectedRelativePath = path;
        this._selectedGridDirectoryPath = null;
        this._NotifyChange("selection");
    }

    SelectGridDirectory(path) {
        if (this._isDisposed) {
            return;
        }
        this._selectedRelativePath = null;
        this._selectedGridDirectoryPath = path;
        this._NotifyChange("selection");
    }

    async RetryDirectory(path) {
        if (this._isDisposed) {
            return { ok: false, stale: true };
        }

        const requestRevision = this._requestRevision;
        const load = this._LoadDirectory(
            path,
            requestRevision,
            true,
        );
        this._NotifyChange("directory");
        const result = await load;
        if (!result.ok || !this._IsCurrentRequest(requestRevision)) {
            if (this._IsCurrentRequest(requestRevision)) {
                this._NotifyChange("directory");
            }
            return result;
        }

        const pathsToRefresh = new Set(
            [...this._expandedPaths].filter(
                (candidatePath) =>
                    candidatePath &&
                    candidatePath !== path &&
                    IsPathWithinDirectory(candidatePath, path),
            ),
        );
        if (
            this._currentPath !== path &&
            IsPathWithinDirectory(this._currentPath, path)
        ) {
            pathsToRefresh.add(this._currentPath);
        }

        const refreshResult = await this._RefreshPaths(
            [...pathsToRefresh],
            requestRevision,
        );
        if (this._IsCurrentRequest(requestRevision)) {
            this._ValidateSelection();
            this._NotifyChange("refresh");
        }
        return refreshResult;
    }

    Dispose() {
        if (this._isDisposed) {
            return;
        }
        this._isDisposed = true;
        this._requestRevision += 1;
    }

    async _RefreshPaths(paths, requestRevision) {
        const orderedPaths = [...new Set(paths)].sort(
            (left, right) => GetPathDepth(left) - GetPathDepth(right),
        );

        for (let startIndex = 0; startIndex < orderedPaths.length;) {
            if (!this._IsCurrentRequest(requestRevision)) {
                return { ok: false, stale: true };
            }

            const depth = GetPathDepth(orderedPaths[startIndex]);
            const pathsAtDepth = [];
            while (
                startIndex < orderedPaths.length &&
                GetPathDepth(orderedPaths[startIndex]) === depth
            ) {
                pathsAtDepth.push(orderedPaths[startIndex]);
                startIndex += 1;
            }

            const pendingLoads = [];
            for (const path of pathsAtDepth) {
                if (this._HasErrorInAncestors(path)) {
                    continue;
                }
                if (!this._IsDirectoryListed(path)) {
                    this._HandleMissingDirectory(path);
                    continue;
                }
                pendingLoads.push(
                    this._LoadDirectory(path, requestRevision, true),
                );
            }
            await Promise.all(pendingLoads);
        }

        return { ok: true };
    }

    async _FetchEntries(path) {
        const query = new URLSearchParams({ path });
        const response = await this._fetcher(
            "/api/assets?" + query.toString(),
            { cache: "no-store" },
        );
        const data = await response.json();

        if (!response.ok) {
            throw CreateAssetDirectoryError(
                data?.error?.message ??
                    "Could not read assets. HTTP " + response.status + ".",
                response.status,
            );
        }
        return ValidateAssetDirectoryData(data, path);
    }

    async _LoadDirectory(path, requestRevision, forceRefresh = false) {
        if (
            !forceRefresh &&
            this._directoryEntries.has(path) &&
            !this._directoryErrors.has(path)
        ) {
            return { ok: true };
        }

        const pendingRequest = this._directoryRequests.get(path);
        if (
            !forceRefresh &&
            pendingRequest?.requestRevision === requestRevision
        ) {
            return pendingRequest.promise;
        }

        const loadToken = ++this._nextDirectoryLoadToken;
        this._directoryLoadTokens.set(path, loadToken);
        this._loadingPaths.set(path, requestRevision);
        this._directoryErrors.delete(path);

        const request = this._FetchEntries(path)
            .then((entries) => {
                if (!this._IsCurrentDirectoryLoad(path, requestRevision, loadToken)) {
                    return { ok: false, stale: true };
                }
                this._directoryEntries.set(path, entries);
                this._directoryErrors.delete(path);
                return { ok: true, entries };
            })
            .catch((error) => {
                if (!this._IsCurrentDirectoryLoad(path, requestRevision, loadToken)) {
                    return { ok: false, stale: true, error };
                }

                if (path && error.statusCode === 404) {
                    this._HandleMissingDirectory(path);
                } else {
                    this._directoryErrors.set(path, error.message);
                    if (path) {
                        this._ClearDirectoryContents(path);
                    }
                    this._logger?.Warn(
                        "Asset browser folder load failed.",
                        error,
                    );
                }
                return { ok: false, error };
            })
            .finally(() => {
                if (this._directoryLoadTokens.get(path) === loadToken) {
                    if (this._loadingPaths.get(path) === requestRevision) {
                        this._loadingPaths.delete(path);
                    }
                    this._directoryLoadTokens.delete(path);
                }
                if (this._directoryRequests.get(path)?.promise === request) {
                    this._directoryRequests.delete(path);
                }
            });

        this._directoryRequests.set(path, {
            requestRevision,
            promise: request,
        });
        return request;
    }

    _IsCurrentDirectoryLoad(path, requestRevision, loadToken) {
        return (
            this._IsCurrentRequest(requestRevision) &&
            this._directoryLoadTokens.get(path) === loadToken
        );
    }

    _IsCurrentRequest(requestRevision) {
        return (
            !this._isDisposed &&
            requestRevision === this._requestRevision
        );
    }

    _IsDirectoryListed(path) {
        if (!path) {
            return this._directoryEntries.has("");
        }
        const parentEntries = this._directoryEntries.get(GetParentPath(path));
        return Boolean(
            parentEntries?.some(
                (entry) =>
                    entry.kind === "directory" &&
                    entry.relativePath === path,
            ),
        );
    }

    _HasErrorInAncestors(path) {
        let ancestorPath = GetParentPath(path);
        while (ancestorPath) {
            if (this._directoryErrors.has(ancestorPath)) {
                return true;
            }
            ancestorPath = GetParentPath(ancestorPath);
        }
        return this._directoryErrors.has("");
    }

    _GetErrorForPath(path) {
        let candidatePath = path;
        while (candidatePath) {
            if (this._directoryErrors.has(candidatePath)) {
                return this._directoryErrors.get(candidatePath);
            }
            candidatePath = GetParentPath(candidatePath);
        }
        return this._directoryErrors.get("") ?? "";
    }

    _HandleMissingDirectory(path) {
        const parentPath = GetParentPath(path);
        const parentEntries = this._directoryEntries.get(parentPath);
        if (parentEntries) {
            this._directoryEntries.set(
                parentPath,
                parentEntries.filter((entry) => entry.relativePath !== path),
            );
        }

        const selectionWasRemoved = IsPathWithinDirectory(
            this._currentPath,
            path,
        );
        this._RemoveDirectorySubtree(path);
        if (selectionWasRemoved) {
            this._currentPath = this._FindNearestExistingDirectory(parentPath);
            this._selectedRelativePath = null;
            this._selectedGridDirectoryPath = null;
        }
    }

    _FindNearestExistingDirectory(path) {
        let candidatePath = path;
        while (candidatePath && !this._IsDirectoryListed(candidatePath)) {
            candidatePath = GetParentPath(candidatePath);
        }
        return candidatePath;
    }

    _RemoveDirectorySubtree(path) {
        for (const cachedPath of [...this._directoryEntries.keys()]) {
            if (IsPathWithinDirectory(cachedPath, path)) {
                this._directoryEntries.delete(cachedPath);
            }
        }
        for (const expandedPath of [...this._expandedPaths]) {
            if (expandedPath && IsPathWithinDirectory(expandedPath, path)) {
                this._expandedPaths.delete(expandedPath);
            }
        }
        for (const errorPath of [...this._directoryErrors.keys()]) {
            if (IsPathWithinDirectory(errorPath, path)) {
                this._directoryErrors.delete(errorPath);
            }
        }
        for (const loadingPath of [...this._directoryLoadTokens.keys()]) {
            if (IsPathWithinDirectory(loadingPath, path)) {
                this._directoryLoadTokens.delete(loadingPath);
                this._directoryRequests.delete(loadingPath);
                this._loadingPaths.delete(loadingPath);
            }
        }
    }

    _ClearDirectoryContents(path) {
        for (const cachedPath of [...this._directoryEntries.keys()]) {
            if (cachedPath && IsPathWithinDirectory(cachedPath, path)) {
                this._directoryEntries.delete(cachedPath);
            }
        }
        for (const errorPath of [...this._directoryErrors.keys()]) {
            if (
                errorPath !== path &&
                IsPathWithinDirectory(errorPath, path)
            ) {
                this._directoryErrors.delete(errorPath);
            }
        }
        for (const loadingPath of [...this._directoryLoadTokens.keys()]) {
            if (
                loadingPath !== path &&
                IsPathWithinDirectory(loadingPath, path)
            ) {
                this._directoryLoadTokens.delete(loadingPath);
                this._directoryRequests.delete(loadingPath);
                this._loadingPaths.delete(loadingPath);
            }
        }
    }

    _ValidateSelection() {
        const entries = this._directoryEntries.get(this._currentPath) ?? [];
        if (
            this._selectedRelativePath &&
            !entries.some(
                (entry) =>
                    entry.kind === "file" &&
                    entry.relativePath === this._selectedRelativePath,
            )
        ) {
            this._selectedRelativePath = null;
        }
        if (
            this._selectedGridDirectoryPath &&
            !entries.some(
                (entry) =>
                    entry.kind === "directory" &&
                    entry.relativePath === this._selectedGridDirectoryPath,
            )
        ) {
            this._selectedGridDirectoryPath = null;
        }
    }

    _ExpandDirectoryAncestors(path) {
        const segments = path.split("/").filter(Boolean);
        let ancestorPath = "";
        this._expandedPaths.add("");
        for (let index = 0; index < segments.length - 1; index += 1) {
            ancestorPath = ancestorPath
                ? ancestorPath + "/" + segments[index]
                : segments[index];
            this._expandedPaths.add(ancestorPath);
        }
    }

    _CreateDirectoryTreeSnapshot(path, name) {
        const entries = this._directoryEntries.get(path);
        const childDirectories = entries?.filter(
            (entry) => entry.kind === "directory",
        ) ?? [];
        const isLoading = this._loadingPaths.has(path);
        const error = this._directoryErrors.get(path) ?? "";
        const isExpanded = this._expandedPaths.has(path);

        return {
            path,
            name,
            isExpanded,
            canExpand: !entries || childDirectories.length > 0 || isLoading ||
                Boolean(error),
            isLoading,
            error,
            children: isExpanded
                ? childDirectories.map((entry) =>
                    this._CreateDirectoryTreeSnapshot(
                        entry.relativePath,
                        entry.name,
                    )
                )
                : [],
        };
    }

    _NotifyChange(reason = "state") {
        if (!this._isDisposed) {
            this._onChange(reason);
        }
    }
}
