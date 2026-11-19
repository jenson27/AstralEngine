function RequireNonEmptyString(value, name) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new TypeError(`${name} must be a non-empty string.`);
    }
}

function GetDockPointerCoordinate(dockName, event) {
    return DOCK_RESIZE_CONFIG[dockName].axis === "x"
        ? event.clientX
        : event.clientY;
}

const DOCK_RESIZE_CONFIG = Object.freeze({
    left: Object.freeze({
        initial: 272,
        minimum: 192,
        maximum: 480,
        axis: "x",
        styleProperty: "--editor-left-dock-width",
    }),
    bottom: Object.freeze({
        initial: 320,
        minimum: 192,
        maximum: 600,
        axis: "y",
        styleProperty: "--editor-bottom-dock-height",
    }),
});
const RESIZE_HANDLE_SIZE = 6;
const MIN_VIEWPORT_WIDTH = 320;
const MIN_VIEWPORT_HEIGHT = 220;
const STACKED_LAYOUT_WIDTH = 1100;

export class EditorShell {
    constructor(rootElement) {
        if (!(rootElement instanceof HTMLElement)) {
            throw new TypeError("EditorShell requires a root element.");
        }

        this._root = rootElement;
        this._workspace = this._root.querySelector(".editor-workspace");

        if (!(this._workspace instanceof HTMLElement)) {
            throw new TypeError("EditorShell requires a workspace element.");
        }

        this._docks = new Map([
            ["left", this._RequireDock("left")],
            ["bottom", this._RequireDock("bottom")],
        ]);
        this._dockTabs = new Map([
            ["bottom", this._RequireDockTabs("bottom")],
        ]);
        this._splitters = new Map([
            ["left", this._RequireSplitter("left")],
            ["bottom", this._RequireSplitter("bottom")],
        ]);
        this._dockSizes = {
            left: DOCK_RESIZE_CONFIG.left.initial,
            bottom: DOCK_RESIZE_CONFIG.bottom.initial,
        };
        this._activePanelIds = new Map();
        this._activeResize = null;
        this._resizeListenersAttached = false;
        this._panelDefinitions = [];
        this._panelIds = new Set();
        this._mountedPanels = [];
        this._isMounted = false;
        this._onSplitterPointerDown = (event) =>
            this._StartDockResize(event);
        this._onSplitterPointerMove = (event) => this._ResizeDock(event);
        this._onSplitterPointerEnd = (event) => this._EndDockResize(event);
        this._onSplitterKeyDown = (event) =>
            this._HandleSplitterKeyDown(event);
        this._onWindowResize = () => this._ClampDockSizesToWorkspace();
        this._onDockTabClick = (event) => this._HandleDockTabClick(event);
        this._onDockTabKeyDown = (event) =>
            this._HandleDockTabKeyDown(event);
    }

    RegisterPanel(id, { title, dock = "bottom", create } = {}) {
        RequireNonEmptyString(id, "Panel ID");
        RequireNonEmptyString(title, "Panel title");

        if (!this._docks.has(dock)) {
            throw new TypeError(`Unsupported editor dock: ${dock}.`);
        }

        if (typeof create !== "function") {
            throw new TypeError("Editor panel factory must be a function.");
        }

        if (this._isMounted) {
            throw new Error("Editor panels cannot be registered after mounting.");
        }

        if (this._panelIds.has(id)) {
            throw new Error(`Editor panel ID is already registered: ${id}.`);
        }

        this._panelIds.add(id);
        this._panelDefinitions.push({ id, title, dock, create });
    }

    _CreatePanelElement(definition) {
        const isBottomPanel = definition.dock === "bottom";
        const panelElement = document.createElement("section");
        panelElement.className = isBottomPanel
            ? "editor-bottom-panel"
            : "editor-panel";
        panelElement.id = `editor-panel-${definition.id}`;
        panelElement.dataset.panelId = definition.id;

        if (isBottomPanel) {
            panelElement.setAttribute("role", "tabpanel");
            panelElement.setAttribute(
                "aria-labelledby",
                `editor-tab-${definition.id}`,
            );
        } else {
            const header = document.createElement("header");
            header.className = "editor-panel-header";

            const title = document.createElement("h2");
            title.textContent = definition.title;
            header.append(title);
            panelElement.append(header);
        }

        const contentElement = document.createElement("div");
        contentElement.className = isBottomPanel
            ? "editor-bottom-panel-content"
            : "editor-panel-content";
        panelElement.append(contentElement);

        return { panelElement, contentElement };
    }

    _CreateDockTab(definition, panelElement, isActive) {
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = "editor-dock-tab";
        tab.id = `editor-tab-${definition.id}`;
        tab.dataset.editorPanelTab = definition.id;
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-controls", panelElement.id);
        tab.setAttribute("aria-selected", String(isActive));
        tab.tabIndex = isActive ? 0 : -1;
        tab.textContent = definition.title;
        this._dockTabs.get(definition.dock).append(tab);
    }

    _MountPanel(definition, context) {
        const { panelElement, contentElement } =
            this._CreatePanelElement(definition);
        const isActive =
            definition.dock !== "bottom" ||
            !this._activePanelIds.has(definition.dock);

        if (isActive && definition.dock === "bottom") {
            this._activePanelIds.set(definition.dock, definition.id);
        }

        panelElement.hidden = !isActive;
        contentElement.hidden = !isActive;
        this._docks.get(definition.dock).append(panelElement);

        if (definition.dock === "bottom") {
            this._CreateDockTab(definition, panelElement, isActive);
        }

        const mountedPanel = {
            definition,
            element: panelElement,
            contentElement,
            instance: null,
        };
        this._mountedPanels.push(mountedPanel);
        mountedPanel.instance = definition.create(contentElement, context);

        if (
            !mountedPanel.instance ||
            typeof mountedPanel.instance.Dispose !== "function"
        ) {
            throw new TypeError(
                `Editor panel '${definition.id}' must provide Dispose().`,
            );
        }

        if (isActive) {
            mountedPanel.instance.OnShow?.();
        } else {
            mountedPanel.instance.OnHide?.();
        }
    }

    Mount(context = {}) {
        if (this._isMounted) {
            throw new Error("EditorShell is already mounted.");
        }

        this._isMounted = true;

        try {
            this._InitializeDockSizes();
            this._AttachResizeListeners();

            for (const definition of this._panelDefinitions) {
                this._MountPanel(definition, context);
            }
        } catch (error) {
            try {
                this.Dispose();
            } catch {
                // Keep the panel creation error as the reported failure.
            }

            throw error;
        }
    }

    Dispose() {
        this._DetachResizeListeners();
        let disposeError = null;

        for (let index = this._mountedPanels.length - 1; index >= 0; index -= 1) {
            const mountedPanel = this._mountedPanels[index];

            if (!mountedPanel.element.hidden) {
                try {
                    mountedPanel.instance?.OnHide?.();
                } catch (error) {
                    disposeError ??= error;
                }
            }

            try {
                mountedPanel.instance?.Dispose();
            } catch (error) {
                disposeError ??= error;
            }

            mountedPanel.element.remove();
        }

        for (const tabs of this._dockTabs.values()) {
            tabs.replaceChildren();
        }

        this._mountedPanels.length = 0;
        this._activePanelIds.clear();
        this._isMounted = false;

        if (disposeError) {
            throw disposeError;
        }
    }

    _RequireDock(dockName) {
        return this._RequireElement(
            `[data-editor-dock="${dockName}"]`,
            `the ${dockName} dock`,
        );
    }

    _RequireDockTabs(dockName) {
        return this._RequireElement(
            `[data-editor-dock-tabs="${dockName}"]`,
            `${dockName} dock tabs`,
        );
    }

    _RequireSplitter(dockName) {
        return this._RequireElement(
            `[data-editor-splitter="${dockName}"]`,
            `the ${dockName} resize handle`,
        );
    }

    _RequireElement(selector, description) {
        const element = this._root.querySelector(selector);

        if (!(element instanceof HTMLElement)) {
            throw new TypeError(`EditorShell requires ${description}.`);
        }

        return element;
    }

    _InitializeDockSizes() {
        const isStackedLayout = window.matchMedia(
            `(max-width: ${STACKED_LAYOUT_WIDTH}px)`,
        ).matches;

        for (const dockName of ["left", "bottom"]) {
            const dockElement =
                dockName === "bottom"
                    ? this._root.querySelector(".editor-bottom-dock")
                    : this._docks.get(dockName);
            const dockBounds = dockElement.getBoundingClientRect();
            const measuredSize =
                DOCK_RESIZE_CONFIG[dockName].axis === "x"
                    ? dockBounds.width
                    : dockBounds.height;
            const size =
                (dockName === "left" && isStackedLayout) || measuredSize === 0
                    ? DOCK_RESIZE_CONFIG[dockName].initial
                    : measuredSize;
            this._SetDockSize(dockName, size);
        }
    }

    _ForEachResizeListener(methodName) {
        const bindings = [
            ["pointerdown", this._onSplitterPointerDown],
            ["pointermove", this._onSplitterPointerMove],
            ["pointerup", this._onSplitterPointerEnd],
            ["pointercancel", this._onSplitterPointerEnd],
            ["lostpointercapture", this._onSplitterPointerEnd],
            ["keydown", this._onSplitterKeyDown],
        ];

        for (const splitter of this._splitters.values()) {
            for (const [eventName, handler] of bindings) {
                splitter[methodName](eventName, handler);
            }
        }

        for (const tabs of this._dockTabs.values()) {
            tabs[methodName]("click", this._onDockTabClick);
            tabs[methodName]("keydown", this._onDockTabKeyDown);
        }

        window[methodName]("resize", this._onWindowResize);
    }

    _AttachResizeListeners() {
        if (this._resizeListenersAttached) {
            return;
        }

        this._ForEachResizeListener("addEventListener");
        this._resizeListenersAttached = true;
    }

    _DetachResizeListeners() {
        if (!this._resizeListenersAttached) {
            return;
        }

        this._ForEachResizeListener("removeEventListener");
        this._activeResize = null;
        this._resizeListenersAttached = false;
    }

    _HandleDockTabClick(event) {
        const tab = event.target.closest("[data-editor-panel-tab]");

        if (!tab || !event.currentTarget.contains(tab)) {
            return;
        }

        this._SetActivePanel(tab.dataset.editorPanelTab);
    }

    _HandleDockTabKeyDown(event) {
        const tabs = [...event.currentTarget.querySelectorAll("[role='tab']")];
        const currentIndex = tabs.indexOf(event.target);

        if (currentIndex < 0 || tabs.length < 1) {
            return;
        }

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
        tabs[nextIndex].focus();
        this._SetActivePanel(tabs[nextIndex].dataset.editorPanelTab);
    }

    _SetActivePanel(panelId) {
        const mountedPanel = this._mountedPanels.find(
            (panel) => panel.definition.id === panelId,
        );

        if (!mountedPanel || mountedPanel.definition.dock !== "bottom") {
            return;
        }

        const previousPanelId = this._activePanelIds.get("bottom");

        if (previousPanelId === panelId) {
            return;
        }

        const previousPanel = this._mountedPanels.find(
            (panel) => panel.definition.id === previousPanelId,
        );
        let lifecycleError = null;

        try {
            previousPanel?.instance?.OnHide?.();
        } catch (error) {
            lifecycleError = error;
        }

        this._activePanelIds.set("bottom", panelId);
        this._UpdateDockPanelVisibility(panelId);
        this._UpdateDockTabSelection(panelId);

        try {
            mountedPanel.instance.OnShow?.();
        } catch (error) {
            lifecycleError ??= error;
        }

        if (lifecycleError) {
            throw lifecycleError;
        }
    }

    _UpdateDockPanelVisibility(panelId) {
        for (const panel of this._mountedPanels) {
            if (panel.definition.dock !== "bottom") {
                continue;
            }

            const isActive = panel.definition.id === panelId;
            panel.element.hidden = !isActive;
            panel.contentElement.hidden = !isActive;
        }
    }

    _UpdateDockTabSelection(panelId) {
        for (const tab of this._dockTabs
            .get("bottom")
            .querySelectorAll("[data-editor-panel-tab]")) {
            const isActive = tab.dataset.editorPanelTab === panelId;
            tab.setAttribute("aria-selected", String(isActive));
            tab.tabIndex = isActive ? 0 : -1;
        }
    }

    _StartDockResize(event) {
        if (event.button !== 0) {
            return;
        }

        const dockName = event.currentTarget.dataset.editorSplitter;
        const splitter = this._splitters.get(dockName);

        if (!splitter) {
            return;
        }

        const coordinate = GetDockPointerCoordinate(dockName, event);
        event.preventDefault();
        this._activeResize = {
            dockName,
            pointerId: event.pointerId,
            startCoordinate: coordinate,
            startSize: this._dockSizes[dockName],
        };
        splitter.setPointerCapture(event.pointerId);
    }

    _ResizeDock(event) {
        const activeResize = this._activeResize;

        if (!activeResize || activeResize.pointerId !== event.pointerId) {
            return;
        }

        const coordinate = GetDockPointerCoordinate(
            activeResize.dockName,
            event,
        );
        const distance = coordinate - activeResize.startCoordinate;
        const direction = activeResize.dockName === "bottom" ? -1 : 1;
        this._SetDockSize(
            activeResize.dockName,
            activeResize.startSize + distance * direction,
        );
    }

    _EndDockResize(event) {
        if (this._activeResize?.pointerId === event.pointerId) {
            this._activeResize = null;
        }
    }

    _HandleSplitterKeyDown(event) {
        const dockName = event.currentTarget.dataset.editorSplitter;
        const config = DOCK_RESIZE_CONFIG[dockName];

        if (!config) {
            return;
        }

        const step = event.shiftKey ? 32 : 16;
        let size = this._dockSizes[dockName];

        if (event.key === "Home") {
            size = config.minimum;
        } else if (event.key === "End") {
            size = this._GetMaximumDockSize(dockName);
        } else if (config.axis === "x" && event.key === "ArrowLeft") {
            size -= step;
        } else if (config.axis === "x" && event.key === "ArrowRight") {
            size += step;
        } else if (config.axis === "y" && event.key === "ArrowUp") {
            size -= step;
        } else if (config.axis === "y" && event.key === "ArrowDown") {
            size += step;
        } else {
            return;
        }

        event.preventDefault();
        this._SetDockSize(dockName, size);
    }

    _ClampDockSizesToWorkspace() {
        if (
            !window.matchMedia(`(max-width: ${STACKED_LAYOUT_WIDTH}px)`).matches
        ) {
            this._SetDockSize("left", this._dockSizes.left);
        }

        this._SetDockSize("bottom", this._dockSizes.bottom);
    }

    _GetMaximumDockSize(dockName) {
        const config = DOCK_RESIZE_CONFIG[dockName];
        let availableSize;

        if (config.axis === "x") {
            availableSize =
                this._workspace.getBoundingClientRect().width -
                MIN_VIEWPORT_WIDTH -
                RESIZE_HANDLE_SIZE;
        } else {
            const toolbarHeight = this._root.querySelector(
                ".editor-toolbar",
            ).getBoundingClientRect().height;
            availableSize =
                this._root.getBoundingClientRect().height -
                toolbarHeight -
                MIN_VIEWPORT_HEIGHT -
                RESIZE_HANDLE_SIZE;
        }

        return Math.max(
            config.minimum,
            Math.min(config.maximum, Math.floor(availableSize)),
        );
    }

    _SetDockSize(dockName, size) {
        const config = DOCK_RESIZE_CONFIG[dockName];
        const maximumSize = this._GetMaximumDockSize(dockName);
        const clampedSize = Math.min(
            maximumSize,
            Math.max(config.minimum, size),
        );

        this._dockSizes[dockName] = clampedSize;
        const styleTarget = dockName === "left" ? this._workspace : this._root;
        styleTarget.style.setProperty(
            config.styleProperty,
            `${clampedSize}px`,
        );
        this._UpdateSplitterValues();
    }

    _UpdateSplitterValues() {
        for (const dockName of ["left", "bottom"]) {
            const splitter = this._splitters.get(dockName);
            const config = DOCK_RESIZE_CONFIG[dockName];
            splitter.setAttribute("aria-valuemin", String(config.minimum));
            splitter.setAttribute(
                "aria-valuemax",
                String(this._GetMaximumDockSize(dockName)),
            );
            splitter.setAttribute(
                "aria-valuenow",
                String(Math.round(this._dockSizes[dockName])),
            );
        }
    }
}
