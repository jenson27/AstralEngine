import { CreateElement } from "./dom-utils.js";

function GetParentPath(path) {
    if (!path) {
        return "";
    }
    const separatorIndex = path.lastIndexOf("/");
    return separatorIndex < 0 ? "" : path.slice(0, separatorIndex);
}

export class SceneDocumentTabs {
    constructor(rootElement, { onSelect, onClose }) {
        if (!(rootElement instanceof HTMLElement)) {
            throw new TypeError("Scene document tabs require a root element.");
        }
        if (
            typeof onSelect !== "function" ||
            typeof onClose !== "function"
        ) {
            throw new TypeError(
                "Scene document tabs require select and close handlers.",
            );
        }

        this._root = rootElement;
        this._handlers = { onSelect, onClose };
        this._onClick = (event) => this._HandleClick(event);
        this._onKeyDown = (event) => this._HandleKeyDown(event);
        this._root.addEventListener("click", this._onClick);
        this._root.addEventListener("keydown", this._onKeyDown);
    }

    Render(snapshot) {
        this._root.replaceChildren();

        if (snapshot.documents.length === 0) {
            const empty = CreateElement("span", "editor-scene-tabs-empty");
            empty.textContent = "No open scenes";
            this._root.append(empty);
            return;
        }

        const titleCounts = this._CountTitles(snapshot.documents);
        const renderContext = {
            activeDocumentId: snapshot.activeDocumentId,
            titleCounts,
        };
        snapshot.documents.forEach((document, index) =>
            this._root.append(
                this._CreateTabItem(document, index, renderContext),
            ),
        );
    }

    _CountTitles(documents) {
        const titleCounts = new Map();
        for (const document of documents) {
            const key = document.title.toLocaleLowerCase();
            titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
        }
        return titleCounts;
    }

    _CreateTabItem(document, index, { activeDocumentId, titleCounts }) {
        const isActive = document.id === activeDocumentId;
        const item = CreateElement("div", "editor-scene-tab-item");
        item.dataset.active = String(isActive);

        const tab = CreateElement("button", "editor-scene-tab");
        tab.type = "button";
        tab.dataset.documentTab = document.id;
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-selected", String(isActive));
        tab.setAttribute("aria-controls", "editor-scene-viewport");
        tab.tabIndex = isActive || (!activeDocumentId && index === 0)
            ? 0
            : -1;

        const label = this._GetTabLabel(document, titleCounts);
        const title = CreateElement("span", "editor-scene-tab-title");
        title.textContent = label;
        tab.title = document.relativePath ?? document.title;
        tab.setAttribute(
            "aria-label",
            document.isDirty ? `${label}, unsaved changes` : label,
        );
        tab.append(title);

        if (document.isDirty) {
            const dirtyMark = CreateElement(
                "span",
                "editor-scene-tab-dirty",
            );
            dirtyMark.textContent = "•";
            dirtyMark.setAttribute("aria-hidden", "true");
            tab.append(dirtyMark);
        }

        const close = CreateElement("button", "editor-scene-tab-close");
        close.type = "button";
        close.dataset.documentClose = document.id;
        close.textContent = "×";
        close.setAttribute("aria-label", `Close ${label}`);
        close.title = `Close ${label}`;

        item.append(tab, close);
        return item;
    }

    _GetTabLabel(document, titleCounts) {
        const parentPath = GetParentPath(document.relativePath);
        const isDuplicate =
            (titleCounts.get(document.title.toLocaleLowerCase()) ?? 0) > 1;
        return isDuplicate && parentPath
            ? `${parentPath}/${document.title}`
            : document.title;
    }

    Dispose() {
        this._root.removeEventListener("click", this._onClick);
        this._root.removeEventListener("keydown", this._onKeyDown);
        this._root.replaceChildren();
    }

    _HandleClick(event) {
        const close = event.target.closest("[data-document-close]");
        if (close && this._root.contains(close)) {
            this._handlers.onClose(close.dataset.documentClose);
            return;
        }

        const tab = event.target.closest("[data-document-tab]");
        if (tab && this._root.contains(tab)) {
            this._handlers.onSelect(tab.dataset.documentTab);
        }
    }

    _HandleKeyDown(event) {
        const tab = event.target.closest("[data-document-tab]");
        if (!tab || !this._root.contains(tab)) {
            return;
        }

        const tabs = [...this._root.querySelectorAll("[data-document-tab]")];
        const currentIndex = tabs.indexOf(tab);
        let nextIndex = currentIndex;
        if (event.key === "ArrowRight") {
            nextIndex = (currentIndex + 1) % tabs.length;
        } else if (event.key === "ArrowLeft") {
            nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        } else if (event.key === "Home") {
            nextIndex = 0;
        } else if (event.key === "End") {
            nextIndex = tabs.length - 1;
        } else {
            return;
        }

        event.preventDefault();
        const nextTab = tabs[nextIndex];
        this._handlers.onSelect(nextTab.dataset.documentTab);
        [...this._root.querySelectorAll("[data-document-tab]")]
            .find(
                (candidate) =>
                    candidate.dataset.documentTab ===
                    nextTab.dataset.documentTab,
            )
            ?.focus();
    }
}
