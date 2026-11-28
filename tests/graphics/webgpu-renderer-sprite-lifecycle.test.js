import assert from "node:assert/strict";
import test from "node:test";
import { WebGPURenderer } from "../../src/graphics/webgpu-renderer.js";
import { WebGpuSpriteRenderer } from "../../src/graphics/webgpu-sprite-renderer.js";

function InstallWebGpuEnvironment(context) {
    const previous = new Map(
        ["navigator", "fetch", "GPUBufferUsage", "GPUTextureUsage", "GPUShaderStage"].map((name) => [
            name,
            Object.getOwnPropertyDescriptor(globalThis, name),
        ]),
    );
    const destroyedTextures = [];
    const device = {
        features: new Set(),
        limits: { minUniformBufferOffsetAlignment: 256 },
        lost: Promise.resolve({ reason: "destroyed" }),
        queue: {
            writeBuffer() {},
            writeTexture() {},
            copyExternalImageToTexture() {},
            submit() {},
        },
        addEventListener() {},
        createBuffer(descriptor) {
            return { descriptor, destroy() {} };
        },
        createTexture(descriptor) {
            return {
                descriptor,
                createView() { return {}; },
                destroy() { destroyedTextures.push(descriptor); },
            };
        },
        createShaderModule() { return {}; },
        createBindGroupLayout() { return {}; },
        createPipelineLayout() { return {}; },
        async createRenderPipelineAsync() {
            return { getBindGroupLayout: () => ({}) };
        },
        createBindGroup() { return {}; },
        createSampler() { return {}; },
        destroy() {},
    };
    const contextObject = {
        configured: false,
        unconfigured: false,
        configure() { this.configured = true; },
        unconfigure() { this.unconfigured = true; },
    };
    const activeResources = new Map();
    const memoryTracker = {
        TrackResource(resource) {
            const token = {};
            activeResources.set(token, resource);
            return token;
        },
        ReleaseResource(token) { activeResources.delete(token); },
        get ActiveResources() { return [...activeResources.values()]; },
    };

    Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: {
            gpu: {
                requestAdapter: async () => ({
                    features: new Set(),
                    requestDevice: async () => device,
                }),
                getPreferredCanvasFormat: () => "bgra8unorm",
            },
        },
    });
    Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        value: async () => ({ ok: true, text: async () => "shader" }),
    });
    Object.defineProperty(globalThis, "GPUBufferUsage", {
        configurable: true,
        value: { UNIFORM: 1, COPY_DST: 2, VERTEX: 4, INDEX: 8, QUERY_RESOLVE: 16, COPY_SRC: 32, MAP_READ: 64 },
    });
    Object.defineProperty(globalThis, "GPUTextureUsage", {
        configurable: true,
        value: { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_DST: 4 },
    });
    Object.defineProperty(globalThis, "GPUShaderStage", {
        configurable: true,
        value: { VERTEX: 1, FRAGMENT: 2 },
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

    return { activeResources, contextObject, destroyedTextures, device, memoryTracker };
}

function CreateCanvas(contextObject) {
    return {
        width: 64,
        height: 64,
        getContext: (kind) => kind === "webgpu" ? contextObject : null,
    };
}

function CreateSpriteItem(texture) {
    return {
        texture,
        uvRect: [0, 0, 1, 1],
        position: [0, 0, 0],
        width: 1,
        right: [1, 0, 0],
        height: 1,
        up: [0, 1, 0],
        pivot: [0.5, 0.5],
        tint: [1, 1, 1, 1],
    };
}

const identityMatrix = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]);

test("public renderer lifecycle prunes inactive sprite textures", async (context) => {
    const environment = InstallWebGpuEnvironment(context);
    const renderer = new WebGPURenderer(
        CreateCanvas(environment.contextObject),
        environment.memoryTracker,
    );
    await renderer.Initialize();

    const firstImage = { bitmap: {}, width: 1, height: 1 };
    const secondImage = { bitmap: {}, width: 1, height: 1 };
    renderer.SetRenderItems([], identityMatrix, identityMatrix, {}, [CreateSpriteItem(firstImage)]);
    assert.equal(
        environment.memoryTracker.ActiveResources.filter(({ label }) => label === "Material srgb texture").length,
        1,
    );

    renderer.SetRenderItems([], identityMatrix, identityMatrix, {}, [CreateSpriteItem(secondImage)]);
    assert.equal(
        environment.destroyedTextures.filter(({ format }) => format === "rgba8unorm-srgb").length,
        1,
    );
    assert.equal(
        environment.memoryTracker.ActiveResources.filter(({ label }) => label === "Material srgb texture").length,
        1,
    );

    renderer.ClearRenderItems();
    assert.equal(
        environment.destroyedTextures.filter(({ format }) => format === "rgba8unorm-srgb").length,
        2,
    );
    assert.equal(
        environment.memoryTracker.ActiveResources.some(({ label }) => label === "Material srgb texture"),
        false,
    );

    renderer.Shutdown();
    assert.equal(environment.contextObject.unconfigured, true);
    assert.equal(environment.activeResources.size, 0);
});

test("sprite renderer exposes a defensive snapshot of active images", async (context) => {
    const environment = InstallWebGpuEnvironment(context);
    const spriteRenderer = new WebGpuSpriteRenderer({
        device: environment.device,
        format: "bgra8unorm",
        depthFormat: "depth24plus",
        resourceCache: { GetTextureResource: (image) => ({ view: image }) },
        trackGpuResource: () => null,
        destroyGpuResource() {},
    });
    await spriteRenderer.Initialize();
    const image = { bitmap: {}, width: 1, height: 1 };
    spriteRenderer.SetRenderItems([CreateSpriteItem(image)], identityMatrix, identityMatrix);

    const snapshot = spriteRenderer.ActiveImages;
    snapshot.clear();
    assert.equal(spriteRenderer.ActiveImages.has(image), true);

    spriteRenderer.Dispose();
});
