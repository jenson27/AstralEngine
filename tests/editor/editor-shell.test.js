import assert from "node:assert/strict";
import test from "node:test";
import { EditorShell } from "../../src/editor/ui/editor-shell.js";

class FakeElement {
    constructor(tagName = "div") {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.parentElement = null;
        this.attributes = new Map();
        this.dataset = {};
        this.styleValues = new Map();
        this.style = {
            setProperty: (name, value) => this.styleValues.set(name, value),
        };
        this.classList = { add: () => {} };
        this.listeners = new Map();
        this.hidden = false;
        this.tabIndex = 0;
        this.rect = { width: 1200, height: 800 };
    }

    append(...elements) {
        for (const element of elements) {
            element.parentElement = this;
            this.children.push(element);
        }
    }

    replaceChildren(...elements) {
        for (const child of this.children) {
            child.parentElement = null;
        }

        this.children = [];
        this.append(...elements);
    }

    remove() {
        if (!this.parentElement) {
            return;
        }

        this.parentElement.children = this.parentElement.children.filter(
            (element) => element !== this,
        );
        this.parentElement = null;
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
        if (
            selector === "[data-editor-panel-tab]" &&
            this.dataset.editorPanelTab !== undefined
        ) {
            return this;
        }

        return null;
    }

    contains(element) {
        return (
            element === this ||
            this.children.some((child) => child.contains(element))
        );
    }

    querySelectorAll(selector) {
        if (
            selector === "[data-editor-panel-tab]" ||
            selector === "[role='tab']"
        ) {
            return this.children.filter(
                (child) => child.dataset.editorPanelTab !== undefined,
            );
        }

        return [];
    }

    getBoundingClientRect() {
        return this.rect;
    }

    focus() {
        globalThis.document.activeElement = this;
    }
}

function InstallFakeDom(testContext) {
    const previous = new Map(
        ["HTMLElement", "document", "window"].map((name) => [
            name,
            Object.getOwnPropertyDescriptor(globalThis, name),
        ]),
    );
    const fakeWindow = {
        listeners: new Map(),
        matchMedia: () => ({ matches: false }),
        addEventListener(name, handler) {
            this.listeners.set(name, handler);
        },
        removeEventListener(name) {
            this.listeners.delete(name);
        },
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

    return { fakeWindow };
}

function CreateEditorShell() {
    const root = new FakeElement("main");
    const workspace = new FakeElement("div");
    const leftDock = new FakeElement("aside");
    const bottomDock = new FakeElement("section");
    const tabs = new FakeElement("nav");
    const leftSplitter = new FakeElement("div");
    const bottomSplitter = new FakeElement("div");
    leftSplitter.dataset.editorSplitter = "left";
    bottomSplitter.dataset.editorSplitter = "bottom";
    const toolbar = new FakeElement("header");
    leftDock.rect.width = 272;
    bottomDock.rect.height = 320;
    toolbar.rect.height = 44;
    const elements = new Map([
        [".editor-workspace", workspace],
        ['[data-editor-dock="left"]', leftDock],
        ['[data-editor-dock="bottom"]', new FakeElement("div")],
        ['[data-editor-dock-tabs="bottom"]', tabs],
        ['[data-editor-splitter="left"]', leftSplitter],
        ['[data-editor-splitter="bottom"]', bottomSplitter],
        [".editor-bottom-dock", bottomDock],
        [".editor-toolbar", toolbar],
    ]);
    root.querySelector = (selector) => elements.get(selector) ?? null;

    return {
        shell: new EditorShell(root),
        elements: {
            workspace,
            tabs,
            leftSplitter,
        },
    };
}

test("editor shell switches tabs and supports keyboard dock resizing", (context) => {
    InstallFakeDom(context);
    const { shell, elements } = CreateEditorShell();
    const disposed = [];

    shell.RegisterPanel("console", {
        title: "Console",
        create: () => ({ Dispose: () => disposed.push("console") }),
    });
    shell.RegisterPanel("profiler", {
        title: "Profiler",
        create: () => ({ Dispose: () => disposed.push("profiler") }),
    });
    shell.Mount();

    const [consoleTab, profilerTab] = elements.tabs.children;
    elements.tabs.Dispatch("click", { target: profilerTab });

    assert.equal(profilerTab.getAttribute("aria-selected"), "true");
    assert.equal(consoleTab.getAttribute("aria-selected"), "false");

    let prevented = false;
    elements.leftSplitter.Dispatch("keydown", {
        key: "ArrowRight",
        shiftKey: false,
        preventDefault: () => (prevented = true),
    });

    assert.equal(prevented, true);
    assert.equal(
        elements.workspace.styleValues.get("--editor-left-dock-width"),
        "288px",
    );

    shell.Dispose();
    assert.deepEqual(disposed, ["profiler", "console"]);
});

test("editor shell completes a tab switch when a lifecycle hook throws", (context) => {
    InstallFakeDom(context);
    const { shell, elements } = CreateEditorShell();
    const expectedError = new Error("Panel hide failed.");
    const events = [];

    shell.RegisterPanel("console", {
        title: "Console",
        create: () => ({
            OnHide() {
                throw expectedError;
            },
            Dispose() {},
        }),
    });
    shell.RegisterPanel("profiler", {
        title: "Profiler",
        create: () => ({
            OnShow: () => events.push("profiler shown"),
            Dispose() {},
        }),
    });
    shell.Mount();
    events.length = 0;

    const [consoleTab, profilerTab] = elements.tabs.children;
    assert.throws(
        () => elements.tabs.Dispatch("click", { target: profilerTab }),
        (error) => error === expectedError,
    );

    assert.equal(consoleTab.getAttribute("aria-selected"), "false");
    assert.equal(profilerTab.getAttribute("aria-selected"), "true");
    assert.deepEqual(events, ["profiler shown"]);
    shell.Dispose();
});
