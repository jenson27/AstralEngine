import assert from "node:assert/strict";
import test from "node:test";
import { MemoryTracker } from "../../src/diagnostics/profiling/memory-tracker.js";
import { Profiler } from "../../src/diagnostics/profiling/profiler.js";
import { ConsolePanel } from "../../src/editor/panels/diagnostics/console-panel.js";
import { MemoryTrackerPanel } from "../../src/editor/panels/diagnostics/memory-tracker/panel.js";
import { ProfilerPanel } from "../../src/editor/panels/diagnostics/profiler/panel.js";
import { SceneHierarchyPanel } from "../../src/editor/panels/scene-hierarchy-panel.js";
import { EditorSelection } from "../../src/editor/editor-selection.js";
import { SetOptions } from "../../src/editor/panels/diagnostics/diagnostic-panel-utils.js";
import { Scene } from "../../src/core/scene/scene.js";
import { SceneManager } from "../../src/core/scene/scene-manager.js";

class FakeElement {
    constructor(tagName = "div") {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.parentElement = null;
        this.attributes = new Map();
        this.dataset = {};
        this._selectors = new Map();
        this._textContent = "";
        this._innerHTML = "";
        this.className = "";
        this.classList = {
            add: (...names) => {
                this.className = [
                    ...new Set([
                        ...this.className.split(" ").filter(Boolean),
                        ...names,
                    ]),
                ].join(" ");
            },
        };
        this.style = { setProperty() {} };
        this.listeners = new Map();
        this.hidden = false;
        this.value = "";
        this.disabled = false;
        this.scrollHeight = 0;
        this.scrollTop = 0;
        this.clientHeight = 0;
        this.isFragment = false;
    }

    set textContent(value) {
        this._textContent = String(value ?? "");
        this.children = [];
    }

    get textContent() {
        return (
            this._textContent +
            this.children.map((child) => child.textContent).join("")
        );
    }

    set innerHTML(value) {
        this._innerHTML = String(value);
        this.children = [];
    }

    get innerHTML() {
        return this._innerHTML;
    }

    append(...elements) {
        for (const element of elements) {
            if (element.isFragment) {
                this.append(...element.children);
                element.children = [];
                continue;
            }

            element.parentElement = this;
            this.children.push(element);
        }
    }

    replaceChildren(...elements) {
        for (const child of this.children) {
            child.parentElement = null;
        }

        this.children = [];
        this._textContent = "";
        this.append(...elements);
    }

    remove() {
        if (this.parentElement) {
            this.parentElement.children = this.parentElement.children.filter(
                (child) => child !== this,
            );
            this.parentElement = null;
        }
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }

    addEventListener(name, handler) {
        const handlers = this.listeners.get(name) ?? new Set();
        handlers.add(handler);
        this.listeners.set(name, handlers);
    }

    removeEventListener(name, handler) {
        this.listeners.get(name)?.delete(handler);
    }

    Dispatch(name, event = {}) {
        for (const handler of this.listeners.get(name) ?? []) {
            handler({
                currentTarget: this,
                target: this,
                preventDefault() {},
                ...event,
            });
        }
    }

    closest(selector) {
        if (MatchesSelector(this, selector)) {
            return this;
        }

        return this.parentElement?.closest(selector) ?? null;
    }

    contains(element) {
        if (element === this) {
            return true;
        }

        if (
            this.children.some((child) => child.contains(element)) ||
            [...this._selectors.values()].some((child) =>
                child.contains(element),
            )
        ) {
            return true;
        }

        return false;
    }

    querySelector(selector) {
        const registeredElement = this._selectors.get(selector);
        if (registeredElement) {
            return registeredElement;
        }

        return this.querySelectorAll(selector)[0] ?? null;
    }

    querySelectorAll(selector) {
        const matches = [];
        const visited = new Set();
        const visit = (element) => {
            if (visited.has(element)) {
                return;
            }

            visited.add(element);
            if (MatchesSelector(element, selector)) {
                matches.push(element);
            }

            for (const child of element.children) {
                visit(child);
            }
        };

        for (const child of this.children) {
            visit(child);
        }

        for (const child of this._selectors.values()) {
            visit(child);
        }

        return matches;
    }

    focus() {
        globalThis.document.activeElement = this;
    }
}

function MatchesSelector(element, selector) {
    if (selector === "button") {
        return element.tagName === "BUTTON";
    }

    if (selector === "[hidden]") {
        return element.hidden;
    }

    if (selector === "[data-entity-id]") {
        return element.dataset.entityId !== undefined;
    }

    if (selector === "[role='tab']") {
        return element.getAttribute("role") === "tab";
    }

    if (selector.startsWith(".")) {
        return element.className.split(" ").includes(selector.slice(1));
    }

    return false;
}

function CreateRoot(selectors) {
    const root = new FakeElement("div");

    for (const [selector, tagName] of selectors) {
        const element = new FakeElement(tagName);
        const role = selector.match(/^\[data-role="([^"]+)"\]$/)?.[1];
        const action = selector.match(/^\[data-action="([^"]+)"\]$/)?.[1];

        if (role) {
            element.dataset.role = role;
        }

        if (action) {
            element.dataset.action = action;
        }

        root._selectors.set(selector, element);
    }

    return root;
}

function InstallFakeDom(testContext) {
    const previous = new Map(
        ["HTMLElement", "document", "window"].map((name) => [
            name,
            Object.getOwnPropertyDescriptor(globalThis, name),
        ]),
    );
    const fakeWindow = {
        matchMedia: () => ({
            matches: false,
            addEventListener() {},
            removeEventListener() {},
        }),
    };

    Object.defineProperty(globalThis, "HTMLElement", {
        configurable: true,
        value: FakeElement,
    });
    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
            activeElement: null,
            createElement: (tagName) => new FakeElement(tagName),
            createElementNS: (_namespace, tagName) => new FakeElement(tagName),
            createDocumentFragment: () => {
                const fragment = new FakeElement();
                fragment.isFragment = true;
                return fragment;
            },
        },
    });
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: fakeWindow,
    });

    testContext.after(() => {
        for (const [name, descriptor] of previous) {
            if (descriptor) {
                Object.defineProperty(globalThis, name, descriptor);
            } else {
                Reflect.deleteProperty(globalThis, name);
            }
        }
    });
}

test("select options update after the focused control loses focus", (context) => {
    InstallFakeDom(context);
    const select = new FakeElement("select");
    const initialOptions = [
        { value: 1, label: "Frame 1" },
        { value: 2, label: "Frame 2" },
    ];
    SetOptions(select, initialOptions, 1);
    const firstOption = select.children[0];

    select.focus();
    SetOptions(
        select,
        [
            { value: 3, label: "Frame 3" },
            { value: 2, label: "Frame 2" },
        ],
        3,
    );

    assert.equal(select.children[0], firstOption);
    assert.equal(select.value, "1");

    select.Dispatch("blur");

    assert.deepEqual(
        select.children.map((option) => option.textContent),
        ["Frame 3", "Frame 2"],
    );
    assert.equal(select.value, "3");
});

test("deferred select updates preserve a valid choice and report a removed choice", (context) => {
    InstallFakeDom(context);
    const select = new FakeElement("select");
    const changes = [];
    SetOptions(
        select,
        [
            { value: "all", label: "All" },
            { value: "first", label: "First" },
        ],
        "first",
    );

    select.focus();
    select.value = "all";
    SetOptions(
        select,
        [
            { value: "all", label: "All owners" },
            { value: "second", label: "Second" },
        ],
        "first",
        (value) => changes.push(value),
    );
    select.Dispatch("blur");

    assert.equal(select.value, "all");
    assert.deepEqual(changes, ["all"]);

    select.focus();
    SetOptions(
        select,
        [{ value: "second", label: "Second" }],
        "all",
        (value) => changes.push(value),
    );
    select.Dispatch("blur");

    assert.equal(select.value, "second");
    assert.deepEqual(changes, ["all", "second"]);
});

test("console panel clears visible and retained entries", (context) => {
    InstallFakeDom(context);
    let logSink = null;
    const logger = {
        GetHistory: () => [],
        AddSink(sink) {
            logSink = sink;
            return () => {
                logSink = null;
            };
        },
    };
    const root = CreateRoot([
        ['[data-role="output"]'],
        ['[data-role="entries"]'],
        ['[data-role="entry-count"]'],
        ['[data-role="level-filter"]', "select"],
        ['[data-role="search-filter"]', "input"],
        ['[data-action="clear"]', "button"],
    ]);
    const panel = new ConsolePanel(logger, root);
    context.after(() => panel.Dispose());

    logSink({
        timestamp: "2026-11-19T10:00:00+08:00",
        level: "INFO",
        message: "Engine ready",
    });
    assert.equal(root.querySelector('[data-role="entries"]').children.length, 1);

    root.Dispatch("click", {
        target: root.querySelector('[data-action="clear"]'),
    });

    assert.equal(root.querySelector('[data-role="entries"]').children.length, 0);
    assert.match(
        root.querySelector('[data-role="entry-count"]').textContent,
        /0 shown · 0 retained/,
    );
    assert.equal(typeof logSink, "function");
});

test("profiler panel toggles capture from its toolbar", (context) => {
    InstallFakeDom(context);
    const profiler = new Profiler();
    profiler.BeginFrame(1);
    const scope = profiler.BeginScope("RenderSystem", "system");
    profiler.EndScope(scope);
    profiler.RecordFrameMetric("frame.deltaMs", 10.5);
    profiler.BeginAsyncScope("AssetLoad", "asset");
    profiler.EndFrame();

    const root = CreateRoot([
        ['[data-action="capture"]', "button"],
        ['[data-role="gpu-timing-status"]'],
        ['[data-role="performance-strip"]'],
        ['[data-role="frame-select"]', "select"],
        ['[data-role="system-filter"]', "select"],
        ['[data-role="scope-filter"]', "input"],
        ['[data-role="frame-graph-scale"]', "select"],
        ['[data-role="frame-graph-caption"]'],
        ['[data-role="frame-graph"]'],
        ['[data-role="system-time-graph"]'],
        ['[data-role="scope-timeline-count"]'],
        ['[data-role="scope-timeline"]'],
        ['[data-role="frame-analysis"]'],
        ['[data-role="scope-count"]'],
        ['[data-role="scope-rows"]'],
        ['[data-role="scope-empty"]'],
        ['[data-role="async-span-count"]'],
        ['[data-role="async-span-rows"]', "tbody"],
        ['[data-role="async-span-empty"]'],
    ]);
    const panel = new ProfilerPanel(profiler, root, {
        GpuTimingSupported: true,
    });
    context.after(() => panel.Dispose());
    const button = root.querySelector('[data-action="capture"]');

    assert.equal(button.textContent, "Pause capture");
    assert.equal(
        root.querySelector('[data-role="gpu-timing-status"]').textContent,
        "GPU timestamps available",
    );
    const performanceCards = root.querySelector(
        '[data-role="performance-strip"]',
    );
    assert.match(performanceCards.textContent, /FPS95\.2 FPS/);
    assert.match(performanceCards.textContent, /Frame time10\.50 ms/);
    assert.match(performanceCards.textContent, /Average frame time10\.50 ms/);
    assert.equal(root.querySelector('[data-role="scope-rows"]').children.length, 1);

    panel.OnShow();
    panel.OnHide();
    assert.equal(
        root.querySelector('[data-role="gpu-timing-status"]').textContent,
        "GPU timestamps available",
    );
    root.Dispatch("click", { target: button });
    assert.equal(profiler.IsEnabled, false);
    assert.equal(button.textContent, "Start capture");
});

test("memory panel shows dropped events and supports snapshot comparison", (context) => {
    InstallFakeDom(context);
    const tracker = new MemoryTracker({ maxEventsPerFrame: 1 });
    tracker.BeginFrame(1);
    tracker.TrackResource({
        label: "First buffer",
        resourceType: "Buffer",
        category: "GPU",
        bytes: 64,
        owner: "Renderer",
    });
    tracker.TrackResource({
        label: "Second buffer",
        resourceType: "Buffer",
        category: "GPU",
        bytes: 128,
        owner: "Renderer",
    });
    tracker.EndFrame();

    const root = CreateRoot([
        ['[data-action="snapshot"]', "button"],
        ['[data-action="browser-memory"]', "button"],
        ['[data-action="compare"]', "button"],
        ['[data-role="memory-frame"]', "select"],
        ['[data-role="memory-owner-filter"]', "select"],
        ['[data-role="memory-frame-graph"]'],
        ['[data-role="memory-analysis"]'],
        ['[data-role="memory-events"]', "tbody"],
        ['[data-role="memory-events-empty"]'],
        ['[data-role="live-resources"]', "tbody"],
        ['[data-role="snapshot-base"]', "select"],
        ['[data-role="snapshot-target"]', "select"],
        ['[data-role="snapshot-comparison"]'],
        ['[data-role="browser-memory"]'],
    ]);
    const panel = new MemoryTrackerPanel(tracker, root);
    context.after(() => panel.Dispose());
    const analysis = root.querySelector('[data-role="memory-analysis"]');

    assert.match(root.innerHTML, /<label>Owner/);
    assert.match(analysis.textContent, /Dropped events1/);
    assert.match(analysis.textContent, /Frame allocated192 B/);

    const snapshotButton = root.querySelector('[data-action="snapshot"]');
    root.Dispatch("click", { target: snapshotButton });
    root.Dispatch("click", { target: snapshotButton });
    const compareButton = root.querySelector('[data-action="compare"]');
    assert.equal(compareButton.disabled, false);

    root.Dispatch("click", { target: compareButton });
    assert.equal(
        root.querySelector('[data-role="snapshot-comparison"]').children.length,
        3,
    );
});

test("hierarchy panel selects a real scene entity without a false disclosure control", async (context) => {
    InstallFakeDom(context);
    const entityId = "00000000-0000-4000-8000-000000000001";
    const scene = new Scene("Test Scene");
    scene.EntityManager.CreateEntity(entityId, "Main Camera");
    scene.Initialize();
    const sceneManager = new SceneManager({
        Load: async () => scene,
    });
    await sceneManager.LoadScene("/test.scene.json");
    const root = CreateRoot([
        ['[data-role="scene-name"]'],
        ['[data-role="entities"]'],
        ['[data-role="empty"]'],
        ['[data-action="create-entity"]'],
    ]);
    const selection = new EditorSelection();
    const authoringController = {
        IsBusy: false,
        CreateEntity() {},
        DeleteEntity() {},
    };
    const panel = new SceneHierarchyPanel(
        sceneManager,
        selection,
        root,
        authoringController,
    );
    context.after(() => panel.Dispose());
    context.after(() => sceneManager.Dispose());
    assert.doesNotMatch(root.innerHTML, /delete-entity/);
    const entityList = root.querySelector('[data-role="entities"]');
    const button = entityList.children[0].children[0];

    assert.doesNotMatch(root.innerHTML, /hierarchy-disclosure/);
    root.Dispatch("click", { target: button });

    const selectedButton = entityList.children[0].children[0];
    assert.equal(selectedButton.getAttribute("aria-pressed"), "true");
});
