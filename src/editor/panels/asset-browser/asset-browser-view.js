import { CreateElement } from "../../ui/dom-utils.js";
import {
    ASSET_FILE_TYPE_OPTIONS,
    FilterAssetEntries,
    FormatAssetFileSize,
    GetAssetFileTypeLabel,
    GetAssetFileUrl,
} from "./asset-browser-model.js";

function CreateButton(className, label) {
    const button = CreateElement("button", className);
    button.type = "button";
    button.textContent = label;
    return button;
}

function GetTreeButtonKey(action, path) {
    return JSON.stringify([action, path]);
}

export class AssetBrowserView {
    constructor(
        rootElement,
        {
            onRefresh,
            onSelectDirectory,
            onToggleDirectory,
            onSelect,
            onSelectGridDirectory,
            onOpenDirectory,
            onRetryDirectory,
            getCatalogAssetIds,
        },
    ) {
        this._rootElement = rootElement;
        this._handlers = {
            onRefresh,
            onSelectDirectory,
            onToggleDirectory,
            onSelect,
            onSelectGridDirectory,
            onOpenDirectory,
            onRetryDirectory,
        };
        this._getCatalogAssetIds = getCatalogAssetIds;
        this._entryButtons = new Map();
        this._treeButtons = new Map();
        this._entryState = {
            currentPath: "",
            entries: [],
            directoryTree: {
                path: "",
                name: "Assets",
                isExpanded: true,
                canExpand: false,
                isLoading: false,
                error: "",
                children: [],
            },
            selectedRelativePath: null,
            selectedGridDirectoryPath: null,
            isLoading: true,
            loadFailed: false,
            loadError: "",
            statusMessage: "",
            statusState: "",
        };

        this._CreateView();
        this._BindEvents();
        this.Render(this._entryState);
    }

    _CreateView() {
        this._root = CreateElement("div", "asset-browser-panel");
        const toolbar = this._CreateToolbar();

        this._breadcrumb = CreateElement("nav", "asset-browser-breadcrumbs");
        this._breadcrumb.setAttribute("aria-label", "Asset folder path");
        this._status = CreateElement("output", "asset-browser-status");
        this._status.setAttribute("aria-live", "polite");

        const body = this._CreateContent();
        this._root.append(toolbar, this._breadcrumb, this._status, body);
        this._rootElement.append(this._root);
    }

    _CreateToolbar() {
        const toolbar = CreateElement("div", "asset-browser-toolbar");
        this._refreshButton = CreateButton("asset-browser-refresh", "Refresh");
        this._refreshButton.setAttribute("aria-label", "Refresh asset files");
        const searchLabel = this._CreateSearchControl();
        const typeLabel = this._CreateTypeFilterControl();

        toolbar.append(this._refreshButton, searchLabel, typeLabel);
        return toolbar;
    }

    _CreateSearchControl() {
        const label = CreateElement("label", "asset-browser-search");
        const caption = CreateElement(
            "span",
            "asset-browser-control-label",
        );
        caption.textContent = "Name";
        this._searchInput = document.createElement("input");
        this._searchInput.type = "search";
        this._searchInput.placeholder = "Search this folder";
        this._searchInput.setAttribute("aria-label", "Search file names");
        label.append(caption, this._searchInput);
        return label;
    }

    _CreateTypeFilterControl() {
        const label = CreateElement(
            "label",
            "asset-browser-type-filter",
        );
        const caption = CreateElement(
            "span",
            "asset-browser-control-label",
        );
        caption.textContent = "Type";
        this._typeSelect = document.createElement("select");
        this._typeSelect.setAttribute("aria-label", "Filter files by type");

        for (const optionDefinition of ASSET_FILE_TYPE_OPTIONS) {
            const option = document.createElement("option");
            option.value = optionDefinition.value;
            option.textContent = optionDefinition.label;
            this._typeSelect.append(option);
        }

        label.append(caption, this._typeSelect);
        return label;
    }

    _CreateContent() {
        const body = CreateElement("div", "asset-browser-body");
        this._folderTreeNavigation = CreateElement(
            "nav",
            "asset-browser-folder-tree",
        );
        this._folderTreeNavigation.setAttribute(
            "aria-label",
            "Asset folders",
        );
        this._folderTree = CreateElement("ul", "asset-browser-tree-list");
        this._folderTree.setAttribute("role", "list");
        this._folderTreeNavigation.append(this._folderTree);
        this._entryList = CreateElement("div", "asset-browser-entry-list");
        this._entryList.setAttribute("role", "list");
        this._entryList.setAttribute("aria-label", "Assets in this folder");
        this._details = CreateElement("section", "asset-browser-details");
        this._details.setAttribute("aria-label", "Selected file details");
        body.append(this._folderTreeNavigation, this._entryList, this._details);
        return body;
    }

    _BindEvents() {
        this._onRefreshClick = () => this._handlers.onRefresh();
        this._onSearchInput = () => this._RenderEntries();
        this._onTypeChange = () => this._RenderEntries();
        this._onTreeClick = (event) => this._HandleTreeClick(event);
        this._onEntryClick = (event) => this._HandleEntryClick(event);
        this._onEntryDoubleClick = (event) =>
            this._HandleEntryDoubleClick(event);
        this._onEntryKeyDown = (event) => this._HandleEntryKeyDown(event);
        this._onBreadcrumbClick = (event) =>
            this._HandleBreadcrumbClick(event);

        this._refreshButton.addEventListener("click", this._onRefreshClick);
        this._searchInput.addEventListener("input", this._onSearchInput);
        this._typeSelect.addEventListener("change", this._onTypeChange);
        this._folderTree.addEventListener("click", this._onTreeClick);
        this._entryList.addEventListener("click", this._onEntryClick);
        this._entryList.addEventListener(
            "dblclick",
            this._onEntryDoubleClick,
        );
        this._entryList.addEventListener("keydown", this._onEntryKeyDown);
        this._breadcrumb.addEventListener(
            "click",
            this._onBreadcrumbClick,
        );
    }

    SetStatus(message, state = "") {
        this._status.textContent = message;
        this._status.dataset.state = state;
    }

    SetRefreshDisabled(disabled) {
        this._refreshButton.disabled = disabled;
    }

    RenderBreadcrumbs(path) {
        this._breadcrumb.replaceChildren();
        this._breadcrumb.append(this._CreateBreadcrumbButton("", "Assets"));

        let currentPath = "";
        for (const segment of path.split("/").filter(Boolean)) {
            currentPath = currentPath ? currentPath + "/" + segment : segment;
            const separator = CreateElement(
                "span",
                "asset-browser-breadcrumb-separator",
            );
            separator.textContent = "/";
            this._breadcrumb.append(
                separator,
                this._CreateBreadcrumbButton(currentPath, segment),
            );
        }
    }

    _CreateBreadcrumbButton(path, label) {
        const button = CreateButton("asset-browser-breadcrumb", label);
        button.dataset.assetDirectory = path;
        return button;
    }

    Render(state) {
        this._entryState = state;
        this.RenderBreadcrumbs(state.currentPath);
        this._RenderDirectoryTree();
        this._RenderEntries();
        this.RenderDetails({
            entries: state.entries,
            selectedRelativePath: state.selectedRelativePath,
        });
    }

    RenderSelection(state) {
        this._entryState = state;
        for (const [path, button] of this._entryButtons) {
            button.setAttribute(
                "aria-pressed",
                String(
                    path === state.selectedRelativePath ||
                        path === state.selectedGridDirectoryPath,
                ),
            );
        }
        this.RenderDetails({
            entries: state.entries,
            selectedRelativePath: state.selectedRelativePath,
        });
    }

    RenderTree(state) {
        this._entryState = state;
        this._RenderDirectoryTree();
    }

    _RenderDirectoryTree() {
        const activeElement = globalThis.document?.activeElement;
        const hasTreeFocus = Boolean(
            activeElement && this._folderTree.contains(activeElement),
        );
        const focusAction = hasTreeFocus
            ? activeElement.dataset.assetTreeAction
            : null;
        const focusPath = hasTreeFocus
            ? activeElement.dataset.assetPath
            : null;
        this._treeButtons.clear();
        this._folderTree.replaceChildren();
        this._folderTree.append(
            this._CreateDirectoryTreeItem(this._entryState.directoryTree),
        );
        if (!hasTreeFocus) {
            return;
        }

        const focusButton = this._treeButtons.get(
            GetTreeButtonKey(focusAction, focusPath),
        ) ?? this._treeButtons.get(
            GetTreeButtonKey("select", focusPath),
        ) ?? this._treeButtons.get(
            GetTreeButtonKey("toggle", focusPath),
        );
        focusButton?.focus?.();
    }

    _CreateDirectoryTreeItem(directory) {
        const treeItem = CreateElement("li", "asset-browser-tree-item");
        treeItem.setAttribute("role", "listitem");
        const row = CreateElement("div", "asset-browser-tree-row");

        if (directory.canExpand) {
            const toggle = CreateButton(
                "asset-browser-tree-toggle",
                directory.isExpanded ? "▾" : "▸",
            );
            toggle.dataset.assetTreeAction = "toggle";
            toggle.dataset.assetPath = directory.path;
            this._treeButtons.set(
                GetTreeButtonKey("toggle", directory.path),
                toggle,
            );
            toggle.setAttribute(
                "aria-label",
                (directory.isExpanded ? "Collapse " : "Expand ") +
                    directory.name,
            );
            toggle.setAttribute(
                "aria-expanded",
                String(directory.isExpanded),
            );
            row.append(toggle);
        } else {
            row.append(CreateElement("span", "asset-browser-tree-spacer"));
        }

        const select = CreateButton("asset-browser-tree-select", "");
        select.dataset.assetTreeAction = "select";
        select.dataset.assetPath = directory.path;
        this._treeButtons.set(
            GetTreeButtonKey("select", directory.path),
            select,
        );
        select.setAttribute(
            "aria-current",
            String(directory.path === this._entryState.currentPath),
        );
        const icon = CreateElement("span", "asset-browser-folder-icon");
        icon.setAttribute("aria-hidden", "true");
        const label = CreateElement("span", "asset-browser-tree-name");
        label.textContent = directory.name;
        select.append(icon, label);
        row.append(select);
        treeItem.append(row);

        if (!directory.isExpanded) {
            return treeItem;
        }

        const childList = CreateElement(
            "ul",
            "asset-browser-tree-children",
        );
        childList.setAttribute("role", "list");

        if (directory.isLoading) {
            const loading = CreateElement(
                "li",
                "asset-browser-tree-message",
            );
            loading.textContent = "Loading folders…";
            childList.append(loading);
        } else if (directory.error) {
            childList.append(
                this._CreateDirectoryTreeError(
                    directory.path,
                    directory.error,
                ),
            );
        } else {
            for (const child of directory.children) {
                childList.append(
                    this._CreateDirectoryTreeItem(child),
                );
            }
        }

        if (childList.children.length > 0) {
            treeItem.append(childList);
        }
        return treeItem;
    }

    _CreateDirectoryTreeError(path, message) {
        const item = CreateElement("li", "asset-browser-tree-error");
        const text = CreateElement("span", "asset-browser-tree-error-text");
        text.textContent = message;
        const retry = CreateButton("asset-browser-tree-retry", "Retry");
        retry.dataset.assetTreeAction = "retry";
        retry.dataset.assetPath = path;
        this._treeButtons.set(GetTreeButtonKey("retry", path), retry);
        item.append(text, retry);
        return item;
    }

    _HandleTreeClick(event) {
        const button = event.target.closest("[data-asset-tree-action]");
        if (!button || !this._folderTree.contains(button)) {
            return;
        }

        const path = button.dataset.assetPath;
        switch (button.dataset.assetTreeAction) {
            case "toggle":
                this._handlers.onToggleDirectory(path);
                break;
            case "select":
                this._handlers.onSelectDirectory(path);
                break;
            case "retry":
                this._handlers.onRetryDirectory(path);
                break;
        }
    }

    _RenderEntries() {
        this._entryButtons.clear();
        this._entryList.replaceChildren();
        const {
            entries,
            selectedRelativePath,
            selectedGridDirectoryPath,
            isLoading,
            loadFailed,
            loadError,
            statusMessage,
            statusState,
        } = this._entryState;
        const filteredEntries = FilterAssetEntries(entries, {
            searchText: this._searchInput.value,
            typeFilter: this._typeSelect.value,
        });
        this._SetFilteredEntryCount(
            filteredEntries,
            isLoading,
            loadFailed,
            statusMessage,
            statusState,
        );

        if (filteredEntries.length === 0) {
            this._entryList.append(
                this._CreateEmptyEntryMessage(
                    entries,
                    isLoading,
                    loadFailed,
                    loadError,
                ),
            );
            return;
        }

        for (const entry of filteredEntries) {
            this._entryList.append(
                this._CreateEntryItem(
                    entry,
                    selectedRelativePath,
                    selectedGridDirectoryPath,
                ),
            );
        }
    }

    _SetFilteredEntryCount(
        entries,
        isLoading,
        loadFailed,
        statusMessage,
        statusState,
    ) {
        if (statusMessage) {
            this.SetStatus(statusMessage, statusState);
            return;
        }
        if (isLoading || loadFailed) {
            if (loadFailed) {
                this.SetStatus("This folder could not be listed.", "error");
            }
            return;
        }

        const fileCount = entries.filter(
            (entry) => entry.kind === "file",
        ).length;
        const folderCount = entries.length - fileCount;
        this.SetStatus(
            fileCount + (fileCount === 1 ? " file · " : " files · ") +
                folderCount + (folderCount === 1 ? " folder" : " folders"),
        );
    }

    _CreateEmptyEntryMessage(entries, isLoading, loadFailed, loadError) {
        const empty = CreateElement("p", "asset-browser-empty");
        empty.textContent = isLoading && entries.length === 0
            ? "Loading files…"
            : loadFailed
              ? "This folder could not be listed: " + loadError
              : entries.length
                ? "No files match the current search and type filter."
                : "This folder is empty.";
        return empty;
    }

    _CreateEntryItem(
        entry,
        selectedRelativePath,
        selectedGridDirectoryPath,
    ) {
        const item = CreateElement("div", "asset-browser-entry-item");
        item.setAttribute("role", "listitem");

        const button = CreateButton("asset-browser-entry", "");
        button.dataset.assetPath = entry.relativePath;
        button.dataset.assetKind = entry.kind;
        button.setAttribute(
            "aria-pressed",
            String(
                entry.relativePath === selectedRelativePath ||
                    entry.relativePath === selectedGridDirectoryPath,
            ),
        );
        this._entryButtons.set(entry.relativePath, button);
        button.append(
            this._CreateEntryIcon(entry),
            this._CreateEntryName(entry),
            this._CreateEntryMetadata(entry),
        );
        item.append(button);
        return item;
    }

    _CreateEntryIcon(entry) {
        const icon = CreateElement("span", "asset-browser-entry-icon");
        icon.setAttribute("aria-hidden", "true");
        icon.dataset.assetKind = entry.kind;
        if (entry.kind === "directory") {
            icon.append(CreateElement("span", "asset-browser-folder-icon"));
        } else if (entry.type === "image") {
            const image = document.createElement("img");
            image.alt = "";
            image.loading = "lazy";
            image.decoding = "async";
            image.addEventListener("error", () => {
                image.remove();
                icon.textContent = GetAssetFileTypeLabel(entry.type).toUpperCase();
            }, { once: true });
            image.src = GetAssetFileUrl(entry.relativePath);
            icon.append(image);
        } else {
            icon.textContent = GetAssetFileTypeLabel(entry.type).toUpperCase();
        }
        return icon;
    }

    _CreateEntryName(entry) {
        const name = CreateElement("span", "asset-browser-entry-name");
        name.textContent = entry.name;
        return name;
    }

    _CreateEntryMetadata(entry) {
        const detail = CreateElement("span", "asset-browser-entry-meta");
        if (entry.kind === "directory") {
            detail.textContent = "Folder";
            return detail;
        }

        const assetIds = this._getCatalogAssetIds(entry.relativePath);
        const catalogStatus = assetIds.length ? "Registered" : "Unregistered";
        detail.dataset.catalogStatus = catalogStatus.toLowerCase();
        detail.textContent = catalogStatus + " · " +
            FormatAssetFileSize(entry.sizeBytes);
        return detail;
    }

    RenderDetails({ entries, selectedRelativePath }) {
        const selectedEntry = entries.find(
            (entry) =>
                entry.relativePath === selectedRelativePath &&
                entry.kind === "file",
        );

        if (selectedEntry) {
            this._RenderSelectedFileDetails(selectedEntry);
        } else {
            this._RenderEmptyDetails();
        }
    }

    _RenderEmptyDetails() {
        this._details.replaceChildren();
        const heading = CreateElement(
            "h3",
            "asset-browser-details-heading",
        );
        heading.textContent = "Details";
        const detailsBody = CreateElement(
            "div",
            "asset-browser-details-body asset-browser-details-body-empty",
        );
        const empty = CreateElement("p", "asset-browser-empty");
        empty.textContent = "Select a file to view its details.";
        detailsBody.append(empty);
        this._details.append(heading, detailsBody);
    }

    _RenderSelectedFileDetails(entry) {
        this._details.replaceChildren();
        const heading = CreateElement(
            "h3",
            "asset-browser-details-heading",
        );
        heading.textContent = entry.name;
        const detailsBody = CreateElement("div", "asset-browser-details-body");
        detailsBody.append(
            this._CreatePreview(entry),
            this._CreateMetadata(entry),
        );
        this._details.append(heading, detailsBody);
    }

    _CreatePreview(entry) {
        const preview = CreateElement("div", "asset-browser-preview");
        if (entry.type === "image") {
            preview.append(this._CreateImagePreview(entry, preview));
            return preview;
        }

        const typeIcon = CreateElement(
            "span",
            "asset-browser-preview-icon",
        );
        typeIcon.setAttribute("aria-hidden", "true");
        typeIcon.textContent = GetAssetFileTypeLabel(entry.type).toUpperCase();
        preview.append(typeIcon);
        return preview;
    }

    _CreateImagePreview(entry, preview) {
        const image = document.createElement("img");
        image.alt = "Preview of " + entry.name;
        image.addEventListener("error", () => {
            image.remove();
            const fallback = CreateElement(
                "span",
                "asset-browser-preview-icon",
            );
            fallback.textContent = "Image preview unavailable.";
            preview.append(fallback);
        }, { once: true });
        image.src = GetAssetFileUrl(entry.relativePath);
        return image;
    }

    _CreateMetadata(entry) {
        const metadata = CreateElement("dl", "asset-browser-detail-list");
        const assetIds = this._getCatalogAssetIds(entry.relativePath);
        const fields = [
            ["Type", GetAssetFileTypeLabel(entry.type)],
            ["Catalog status", assetIds.length ? "Registered" : "Unregistered"],
            ["Asset IDs", assetIds.length ? assetIds.join(", ") : "—"],
            ["Path", entry.relativePath],
            ["Size", FormatAssetFileSize(entry.sizeBytes)],
        ];

        for (const [label, value] of fields) {
            this._AppendMetadataRow(metadata, label, value);
        }
        return metadata;
    }

    _AppendMetadataRow(metadata, labelText, value) {
        const term = CreateElement("dt", "asset-browser-detail-label");
        const description = CreateElement(
            "dd",
            "asset-browser-detail-value",
        );
        term.textContent = labelText;
        description.textContent = value;
        metadata.append(term, description);
    }

    _HandleEntryClick(event) {
        const button = event.target.closest("[data-asset-path]");
        if (!button || !this._entryList.contains(button)) {
            return;
        }

        if (button.dataset.assetKind === "directory") {
            this._handlers.onSelectGridDirectory(button.dataset.assetPath);
            return;
        }

        this._handlers.onSelect(button.dataset.assetPath);
    }

    _HandleEntryDoubleClick(event) {
        const button = event.target.closest("[data-asset-path]");
        if (
            !button ||
            !this._entryList.contains(button) ||
            button.dataset.assetKind !== "directory"
        ) {
            return;
        }

        this._handlers.onOpenDirectory(button.dataset.assetPath);
    }

    _HandleEntryKeyDown(event) {
        if (event.key !== "Enter") {
            return;
        }
        const button = event.target.closest("[data-asset-path]");
        if (
            !button ||
            !this._entryList.contains(button) ||
            button.dataset.assetKind !== "directory"
        ) {
            return;
        }

        event.preventDefault();
        this._handlers.onOpenDirectory(button.dataset.assetPath);
    }

    _HandleBreadcrumbClick(event) {
        const button = event.target.closest("[data-asset-directory]");
        if (!button || !this._breadcrumb.contains(button)) {
            return;
        }

        this._handlers.onSelectDirectory(button.dataset.assetDirectory);
    }

    Dispose() {
        this._refreshButton.removeEventListener(
            "click",
            this._onRefreshClick,
        );
        this._searchInput.removeEventListener("input", this._onSearchInput);
        this._typeSelect.removeEventListener("change", this._onTypeChange);
        this._folderTree.removeEventListener("click", this._onTreeClick);
        this._entryList.removeEventListener("click", this._onEntryClick);
        this._entryList.removeEventListener(
            "dblclick",
            this._onEntryDoubleClick,
        );
        this._entryList.removeEventListener("keydown", this._onEntryKeyDown);
        this._breadcrumb.removeEventListener(
            "click",
            this._onBreadcrumbClick,
        );
        this._root.remove();
    }
}
