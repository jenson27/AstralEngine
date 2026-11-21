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

export class AssetBrowserView {
    constructor(
        rootElement,
        {
            onRefresh,
            onNavigate,
            onSelect,
            getCatalogAssetIds,
            getBuiltInAssets,
        },
    ) {
        this._rootElement = rootElement;
        this._handlers = {
            onRefresh,
            onNavigate,
            onSelect,
        };
        this._getCatalogAssetIds = getCatalogAssetIds;
        this._getBuiltInAssets = getBuiltInAssets;
        this._entryState = {
            entries: [],
            selectedRelativePath: null,
            isLoading: true,
            loadFailed: false,
        };

        this._CreateView();
        this._BindEvents();
        this.RenderBreadcrumbs("");
        this._RenderEntries();
        this._RenderEmptyDetails();
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
        this._entryList = CreateElement("div", "asset-browser-entry-list");
        this._entryList.setAttribute("role", "list");
        this._entryList.setAttribute("aria-label", "Files and folders");
        this._details = CreateElement("section", "asset-browser-details");
        this._details.setAttribute("aria-label", "Selected file details");
        body.append(this._entryList, this._details);
        return body;
    }

    _BindEvents() {
        this._onRefreshClick = () => this._handlers.onRefresh();
        this._onSearchInput = () => this._RenderEntries();
        this._onTypeChange = () => this._RenderEntries();
        this._onEntryClick = (event) => this._HandleEntryClick(event);
        this._onBreadcrumbClick = (event) =>
            this._HandleBreadcrumbClick(event);

        this._refreshButton.addEventListener("click", this._onRefreshClick);
        this._searchInput.addEventListener("input", this._onSearchInput);
        this._typeSelect.addEventListener("change", this._onTypeChange);
        this._entryList.addEventListener("click", this._onEntryClick);
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

    SetEntryState(state) {
        this._entryState = state;
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

    RenderEntries(state) {
        this.SetEntryState(state);
        this._RenderEntries();
    }

    _RenderEntries() {
        this._entryList.replaceChildren();
        const { entries, selectedRelativePath, isLoading, loadFailed } =
            this._entryState;
        const filteredEntries = FilterAssetEntries(entries, {
            searchText: this._searchInput.value,
            typeFilter: this._typeSelect.value,
        });
        this._SetFilteredEntryCount(filteredEntries, isLoading, loadFailed);

        if (filteredEntries.length === 0) {
            this._entryList.append(
                this._CreateEmptyEntryMessage(entries, isLoading, loadFailed),
            );
            return;
        }

        for (const entry of filteredEntries) {
            this._entryList.append(
                this._CreateEntryItem(entry, selectedRelativePath),
            );
        }
    }

    _SetFilteredEntryCount(entries, isLoading, loadFailed) {
        if (isLoading || loadFailed) {
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

    _CreateEmptyEntryMessage(entries, isLoading, loadFailed) {
        const empty = CreateElement("p", "asset-browser-empty");
        empty.textContent = isLoading && entries.length === 0
            ? "Loading files…"
            : loadFailed
              ? "This folder could not be listed."
              : entries.length
                ? "No files match the current search and type filter."
                : "This folder is empty.";
        return empty;
    }

    _CreateEntryItem(entry, selectedRelativePath) {
        const item = CreateElement("div", "asset-browser-entry-item");
        item.setAttribute("role", "listitem");

        const button = CreateButton("asset-browser-entry", "");
        button.dataset.assetPath = entry.relativePath;
        button.dataset.assetKind = entry.kind;
        button.setAttribute(
            "aria-pressed",
            String(entry.relativePath === selectedRelativePath),
        );
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
        icon.textContent = entry.kind === "directory"
            ? "DIR"
            : GetAssetFileTypeLabel(entry.type).toUpperCase();
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
        this._AppendBuiltInAssetSection(detailsBody);
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
        this._AppendBuiltInAssetSection(detailsBody);
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

    _AppendBuiltInAssetSection(detailsBody) {
        const section = this._CreateBuiltInAssetSection();
        if (section) {
            detailsBody.append(section);
        }
    }

    _CreateBuiltInAssetSection() {
        const builtInAssets = this._getBuiltInAssets();
        if (builtInAssets.length === 0) {
            return null;
        }

        const section = CreateElement(
            "section",
            "asset-browser-built-in-assets",
        );
        const heading = CreateElement(
            "h4",
            "asset-browser-built-in-heading",
        );
        heading.textContent = "Built-in assets";
        const list = CreateElement("ul", "asset-browser-built-in-list");

        for (const asset of builtInAssets) {
            list.append(this._CreateBuiltInAssetItem(asset));
        }

        section.append(heading, list);
        return section;
    }

    _CreateBuiltInAssetItem(asset) {
        const item = CreateElement("li", "asset-browser-built-in-item");
        const assetId = CreateElement("span", "asset-browser-built-in-id");
        assetId.textContent = asset.id;
        const assetType = CreateElement(
            "span",
            "asset-browser-built-in-type",
        );
        assetType.textContent = asset.typeId;
        item.append(assetId, assetType);
        return item;
    }

    _HandleEntryClick(event) {
        const button = event.target.closest("[data-asset-path]");
        if (!button || !this._entryList.contains(button)) {
            return;
        }

        if (button.dataset.assetKind === "directory") {
            this._handlers.onNavigate(button.dataset.assetPath);
            return;
        }

        this._handlers.onSelect(button.dataset.assetPath);
    }

    _HandleBreadcrumbClick(event) {
        const button = event.target.closest("[data-asset-directory]");
        if (!button || !this._breadcrumb.contains(button)) {
            return;
        }

        this._handlers.onNavigate(button.dataset.assetDirectory);
    }

    Dispose() {
        this._refreshButton.removeEventListener(
            "click",
            this._onRefreshClick,
        );
        this._searchInput.removeEventListener("input", this._onSearchInput);
        this._typeSelect.removeEventListener("change", this._onTypeChange);
        this._entryList.removeEventListener("click", this._onEntryClick);
        this._breadcrumb.removeEventListener(
            "click",
            this._onBreadcrumbClick,
        );
        this._root.remove();
    }
}
