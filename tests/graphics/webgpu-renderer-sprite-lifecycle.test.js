import assert from "node:assert/strict";
import test from "node:test";
import { WebGpuResourceCache } from "../../src/graphics/webgpu-resource-cache.js";
import { WebGPURenderer } from "../../src/graphics/webgpu-renderer.js";
import { WebGpuSpriteRenderer } from "../../src/graphics/webgpu-sprite-renderer.js";

test("renderer prunes sprite bindings before shared textures", () => {
    const order = [];
    const liveImage = { bitmap: {}, width: 1, height: 1 };
    const spriteRenderer = {
        _activeImages: new Set(),
        get ActiveImages() {
            return new Set(this._activeImages);
        },
        SetRenderItems(items) {
            this._activeImages = new Set(items.map((item) => item.texture));
        },
        Prune(activeImages) {
            order.push(["sprites", activeImages]);
        },
        ClearRenderItems() {
            this._activeImages.clear();
        },
    };
    const resourceCache = {
        Prune(activeMeshes, activeMaterials, activeSpriteImages) {
            order.push(["cache", activeSpriteImages]);
        },
    };
    const renderer = new WebGPURenderer({});
    renderer._device = { queue: { writeBuffer() {} } };
    renderer._frameBuffer = {};
    renderer._transformBuffer = {};
    renderer._spriteRenderer = spriteRenderer;
    renderer._gpuResourceCache = resourceCache;

    renderer.SetRenderItems(
        [],
        new Float32Array(16),
        new Float32Array(16),
        {},
        [{ texture: liveImage }],
    );

    assert.deepEqual(order.map(([owner]) => owner), ["sprites", "cache"]);
    assert.deepEqual([...order[0][1]], [liveImage]);
    assert.deepEqual([...order[1][1]], [liveImage]);

    const reloadedImage = { bitmap: {}, width: 1, height: 1 };
    order.length = 0;
    renderer.SetRenderItems(
        [],
        new Float32Array(16),
        new Float32Array(16),
        {},
        [{ texture: reloadedImage }],
    );
    assert.deepEqual(order.map(([owner]) => owner), ["sprites", "cache"]);
    assert.deepEqual([...order[1][1]], [reloadedImage]);

    order.length = 0;
    renderer.ClearRenderItems();
    assert.deepEqual(order.map(([owner]) => owner), ["sprites", "cache"]);
    assert.equal(order[1][1].size, 0);
});

test("shared texture remains live while a mesh material or sprite uses it", () => {
    const destroyed = [];
    const cache = new WebGpuResourceCache({
        device: {},
        materialBindGroupLayout: {},
        textureSampler: {},
        mipmapPipeline: { getBindGroupLayout() {} },
        trackGpuResource: () => null,
        destroyGpuResource: (resource) => destroyed.push(resource),
    });
    const image = { bitmap: {}, width: 1, height: 1 };
    const texture = {};
    const resources = new Map([[
        "srgb",
        { texture, memoryToken: null },
    ]]);
    cache._textureResources.set(image, resources);
    const material = { BaseColorTexture: image, MetallicRoughnessTexture: null };

    cache.Prune(new Set(), new Set(), new Set([image]));
    assert.equal(cache._textureResources.has(image), true);

    cache.Prune(new Set(), new Set([material]), new Set());
    assert.equal(cache._textureResources.has(image), true);

    cache.Prune(new Set(), new Set(), new Set());
    assert.equal(cache._textureResources.has(image), false);
    assert.deepEqual(destroyed, [texture]);
});

test("sprite active-image snapshots cannot mutate renderer state", () => {
    const spriteRenderer = new WebGpuSpriteRenderer({
        device: {},
        format: "rgba8unorm",
        depthFormat: "depth24plus",
        resourceCache: {},
        trackGpuResource() {},
        destroyGpuResource() {},
    });
    const image = {};
    spriteRenderer._activeImages.add(image);

    const snapshot = spriteRenderer.ActiveImages;
    snapshot.clear();

    assert.equal(spriteRenderer.ActiveImages.has(image), true);
});

test("shutdown disposes sprite bindings before shared cached resources", () => {
    const order = [];
    const renderer = new WebGPURenderer({});
    renderer._context = { unconfigure() {} };
    renderer._gpuTimingTracker = { Destroy() {} };
    renderer._spriteRenderer = { Dispose: () => order.push("sprites") };
    renderer._gpuResourceCache = { Dispose: () => order.push("cache") };
    renderer._device = { destroy() {} };

    renderer.Shutdown();

    assert.deepEqual(order, ["sprites", "cache"]);
});
