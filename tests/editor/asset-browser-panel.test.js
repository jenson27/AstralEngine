import assert from "node:assert/strict";
import test from "node:test";
import { AssetBrowserPanel } from "../../src/editor/panels/asset-browser/asset-browser-panel.js";

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
        this.value = "";
        this.disabled = false;
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
        for (let element = this; element; element = element.parentElement) {
            if (
                selector === "[data-asset-path]" &&
                element.dataset.assetPath !== undefined
            ) {
                return element;
            }
            if (
                selector === "[data-asset-directory]" &&
                element.dataset.assetDirectory !== undefined
            ) {
                return element;
            }
        }
        return null;
    }

    contains(element) {
        return (
            element === this ||
            this.children.some((child) => child.contains(element))
        );
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

function CreateAssetResponse(entries) {
    return {
        ok: true,
        json: async () => ({
            format: "astral-asset-directory",
            version: 1,
            path: "",
            entries,
        }),
    };
}

function FindByClass(element, className) {
    if (element.className === className) {
        return element;
    }
    for (const child of element.children) {
        const result = FindByClass(child, className);
        if (result) {
            return result;
        }
    }
    return null;
}

function GetPanelElements(root) {
    const searchControl = FindByClass(root, "asset-browser-search");
    const typeControl = FindByClass(root, "asset-browser-type-filter");

    return {
        status: FindByClass(root, "asset-browser-status"),
        entryList: FindByClass(root, "asset-browser-entry-list"),
        details: FindByClass(root, "asset-browser-details"),
        searchInput: searchControl.children.find(
            (child) => child.tagName === "INPUT",
        ),
        typeSelect: typeControl.children.find(
            (child) => child.tagName === "SELECT",
        ),
    };
}

test("panel status counts filtered files and visible folders", async (context) => {
    InstallFakeDom(context);
    const entries = [
        {
            name: "textures",
            relativePath: "textures",
            kind: "directory",
            type: "folder",
            sizeBytes: null,
        },
        {
            name: "grass.png",
            relativePath: "grass.png",
            kind: "file",
            type: "image",
            sizeBytes: 10,
        },
        {
            name: "tree.glb",
            relativePath: "tree.glb",
            kind: "file",
            type: "model",
            sizeBytes: 20,
        },
    ];
    const root = new FakeElement();
    const panel = new AssetBrowserPanel(root, {
        fetcher: async () => CreateAssetResponse(entries),
    });
    context.after(() => panel.Dispose());
    const { status, searchInput, typeSelect } = GetPanelElements(root);
    typeSelect.value = "all";

    await panel.Refresh();
    assert.equal(status.textContent, "2 files · 1 folder");

    typeSelect.value = "image";
    typeSelect.Dispatch("change");
    assert.equal(status.textContent, "1 file · 1 folder");

    searchInput.value = "missing";
    searchInput.Dispatch("input");
    assert.equal(status.textContent, "0 files · 0 folders");
});

test("panel shows a fallback when an image preview fails", async (context) => {
    InstallFakeDom(context);
    const entries = [
        {
            name: "broken.png",
            relativePath: "broken.png",
            kind: "file",
            type: "image",
            sizeBytes: 10,
        },
    ];
    const root = new FakeElement();
    const panel = new AssetBrowserPanel(root, {
        fetcher: async () => CreateAssetResponse(entries),
    });
    context.after(() => panel.Dispose());
    const { details, entryList, typeSelect } = GetPanelElements(root);
    typeSelect.value = "all";

    await panel.Refresh();
    const entryButton = entryList.children[0].children[0];
    entryList.Dispatch("click", { target: entryButton });

    const preview = FindByClass(details, "asset-browser-preview");
    const image = preview.children.find((child) => child.tagName === "IMG");
    assert.ok(image);

    image.Dispatch("error");

    assert.equal(preview.children.some((child) => child.tagName === "IMG"), false);
    assert.equal(
        FindByClass(preview, "asset-browser-preview-icon").textContent,
        "Image preview unavailable.",
    );
});

test("panel shows catalog status, file IDs, and built-in asset IDs", async (context) => {
    InstallFakeDom(context);
    const entries = [
        {
            name: "grass.png",
            relativePath: "grass.png",
            kind: "file",
            type: "image",
            sizeBytes: 10,
        },
        {
            name: "unused.png",
            relativePath: "unused.png",
            kind: "file",
            type: "image",
            sizeBytes: 20,
        },
    ];
    const assetCatalog = {
        GetAssetIdsBySourcePath(sourcePath) {
            return sourcePath === "/assets/grass.png"
                ? ["texture:grass", "texture:grass-alias"]
                : [];
        },
        GetAll() {
            return [{ id: "builtin:cube", typeId: "mesh" }];
        },
    };
    const root = new FakeElement();
    const panel = new AssetBrowserPanel(root, {
        fetcher: async () => CreateAssetResponse(entries),
        getAssetCatalog: () => assetCatalog,
    });
    context.after(() => panel.Dispose());
    const { details, entryList, typeSelect } = GetPanelElements(root);
    typeSelect.value = "all";

    await panel.Refresh();
    assert.equal(details.children.length, 2);

    const [registeredButton, unregisteredButton] = entryList.children.map(
        (item) => item.children[0],
    );
    assert.equal(
        registeredButton.children[2].dataset.catalogStatus,
        "registered",
    );
    assert.match(registeredButton.children[2].textContent, /^Registered/);
    assert.equal(
        unregisteredButton.children[2].dataset.catalogStatus,
        "unregistered",
    );
    assert.match(unregisteredButton.children[2].textContent, /^Unregistered/);

    entryList.Dispatch("click", { target: registeredButton });
    assert.equal(details.children.length, 2);
    const metadata = FindByClass(details, "asset-browser-detail-list");
    assert.equal(metadata.children[3].textContent, "Registered");
    assert.equal(
        metadata.children[5].textContent,
        "texture:grass, texture:grass-alias",
    );

    const builtInSection = FindByClass(
        details,
        "asset-browser-built-in-assets",
    );
    const builtInItem = FindByClass(
        builtInSection,
        "asset-browser-built-in-id",
    );
    assert.equal(builtInItem.textContent, "builtin:cube");
});
