import assert from "node:assert/strict";
import test from "node:test";
import { SceneDocumentTabs } from "../../src/editor/ui/scene-document-tabs.js";

class FakeElement {
    constructor(tagName = "div") {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.parentElement = null;
        this.dataset = {};
        this.attributes = new Map();
        this.listeners = new Map();
        this.className = "";
        this.textContent = "";
    }

    append(...elements) {
        for (const element of elements) {
            element.remove();
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
            handler({ target: this, currentTarget: this, ...event });
        }
    }

    closest(selector) {
        const property = selector === "[data-document-tab]"
            ? "documentTab"
            : selector === "[data-document-close]"
              ? "documentClose"
              : null;
        for (let element = this; element && property; element = element.parentElement) {
            if (element.dataset[property] !== undefined) {
                return element;
            }
        }
        return null;
    }

    contains(element) {
        return element === this || this.children.some(
            (child) => child.contains(element),
        );
    }

    querySelectorAll(selector) {
        const results = [];
        const property = selector === "[data-document-tab]"
            ? "documentTab"
            : null;
        const visit = (element) => {
            for (const child of element.children) {
                if (property && child.dataset[property] !== undefined) {
                    results.push(child);
                }
                visit(child);
            }
        };
        visit(this);
        return results;
    }

    focus() {
        this.isFocused = true;
    }
}

function InstallFakeDom(context) {
    const previous = new Map(
        ["HTMLElement", "document"].map((name) => [
            name,
            Object.getOwnPropertyDescriptor(globalThis, name),
        ]),
    );
    Object.defineProperty(globalThis, "HTMLElement", {
        configurable: true,
        value: FakeElement,
    });
    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: { createElement: (tagName) => new FakeElement(tagName) },
    });
    context.after(() => {
        for (const [name, descriptor] of previous) {
            if (descriptor) {
                Object.defineProperty(globalThis, name, descriptor);
            } else {
                Reflect.deleteProperty(globalThis, name);
            }
        }
    });
}

test("renders tab labels, dirty state, and keyboard selection", (context) => {
    InstallFakeDom(context);
    const selectedDocuments = [];
    const closedDocuments = [];
    const root = new FakeElement("nav");
    const tabs = new SceneDocumentTabs(root, {
        onSelect: (documentId) => selectedDocuments.push(documentId),
        onClose: (documentId) => closedDocuments.push(documentId),
    });
    context.after(() => tabs.Dispose());

    tabs.Render({
        documents: [
            {
                id: "first",
                title: "level.scene.json",
                relativePath: "first/level.scene.json",
                isDirty: true,
            },
            {
                id: "second",
                title: "level.scene.json",
                relativePath: "second/level.scene.json",
                isDirty: false,
            },
        ],
        activeDocumentId: "first",
    });

    const [firstItem, secondItem] = root.children;
    const [firstTab, firstClose] = firstItem.children;
    const [secondTab] = secondItem.children;
    assert.equal(firstTab.getAttribute("aria-selected"), "true");
    assert.equal(firstTab.tabIndex, 0);
    assert.equal(firstTab.children[0].textContent, "first/level.scene.json");
    assert.equal(firstTab.children[1].textContent, "•");
    assert.equal(secondTab.getAttribute("aria-selected"), "false");
    assert.equal(secondTab.children[0].textContent, "second/level.scene.json");

    let defaultPrevented = false;
    root.Dispatch("keydown", {
        target: firstTab,
        key: "ArrowRight",
        preventDefault() {
            defaultPrevented = true;
        },
    });
    root.Dispatch("click", { target: secondTab });
    root.Dispatch("click", { target: firstClose });

    assert.deepEqual(selectedDocuments, ["second", "second"]);
    assert.deepEqual(closedDocuments, ["first"]);
    assert.equal(defaultPrevented, true);
    assert.equal(secondTab.isFocused, true);
});
