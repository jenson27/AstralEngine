import assert from "node:assert/strict";
import test from "node:test";
import { AssetCatalog } from "../src/core/assets/asset-catalog.js";
import { AssetHandle } from "../src/core/assets/asset-handle.js";
import { AssetLoaderRegistry } from "../src/core/assets/asset-loader-registry.js";
import { AssetManager } from "../src/core/assets/asset-manager.js";
import { ImageTextureLoader } from "../src/graphics/assets/image-texture-loader.js";
import { MaterialLoader } from "../src/graphics/assets/material-loader.js";
import { Material } from "../src/graphics/material.js";
import { Mesh } from "../src/graphics/mesh.js";
import { CreateCubeMesh } from "../src/graphics/primitives/cube.js";
import { WebGPURenderer } from "../src/graphics/webgpu-renderer.js";
import { WebGpuResourceCache } from "../src/graphics/webgpu-resource-cache.js";

function CreateLoadedHandle(assetId, asset) {
    const handle = new AssetHandle(assetId);
    handle._Replace(asset);
    return handle;
}

function WithGpuUsage(callback) {
    const names = ["GPUTextureUsage", "GPUBufferUsage"];
    const previous = new Map(names.map((name) => [
        name,
        Object.getOwnPropertyDescriptor(globalThis, name),
    ]));
    Object.defineProperty(globalThis, "GPUTextureUsage", {
        configurable: true,
        value: {
            TEXTURE_BINDING: 1,
            COPY_DST: 2,
            RENDER_ATTACHMENT: 4,
        },
        writable: true,
    });
    Object.defineProperty(globalThis, "GPUBufferUsage", {
        configurable: true,
        value: { UNIFORM: 1, COPY_DST: 2 },
        writable: true,
    });

    try {
        return callback();
    } finally {
        for (const [name, descriptor] of previous) {
            if (descriptor) {
                Object.defineProperty(globalThis, name, descriptor);
            } else {
                Reflect.deleteProperty(globalThis, name);
            }
        }
    }
}

function CreateFakeDevice() {
    const state = {
        textureDescriptors: [],
        textures: [],
        copies: [],
        textureWrites: [],
        buffers: [],
        bufferWrites: [],
        bindGroupDescriptors: [],
        textureViews: [],
        renderPasses: [],
        submissions: [],
    };

    const device = {
        createTexture(descriptor) {
            const texture = {
                descriptor,
                destroyCount: 0,
                destroy() {
                    this.destroyCount += 1;
                },
            };

            texture.createView = (viewDescriptor = {}) => {
                const view = { texture, descriptor: viewDescriptor };
                state.textureViews.push(view);
                return view;
            };
            texture.view = texture.createView();

            state.textureDescriptors.push(descriptor);
            state.textures.push(texture);
            return texture;
        },

        createBindGroup(descriptor) {
            const bindGroup = { descriptor };
            state.bindGroupDescriptors.push(descriptor);
            return bindGroup;
        },

        createBuffer(descriptor) {
            const buffer = {
                descriptor,
                destroyCount: 0,
                destroy() {
                    this.destroyCount += 1;
                },
            };
            state.buffers.push(buffer);
            return buffer;
        },

        createCommandEncoder() {
            const command = { renderPasses: [] };
            return {
                beginRenderPass(descriptor) {
                    const renderPass = {
                        descriptor,
                        pipeline: null,
                        bindGroup: null,
                        drawVertexCount: 0,
                        ended: false,
                        setPipeline(pipeline) {
                            this.pipeline = pipeline;
                        },
                        setBindGroup(index, bindGroup) {
                            this.bindGroup = { index, bindGroup };
                        },
                        draw(vertexCount) {
                            this.drawVertexCount = vertexCount;
                        },
                        end() {
                            this.ended = true;
                        },
                    };
                    command.renderPasses.push(renderPass);
                    state.renderPasses.push(renderPass);
                    return renderPass;
                },
                finish() {
                    return command;
                },
            };
        },

        queue: {
            copyExternalImageToTexture(source, destination, size) {
                state.copies.push({ source, destination, size });
            },
            writeTexture(destination, data, layout, size) {
                state.textureWrites.push({
                    destination,
                    data: data.slice(),
                    layout,
                    size,
                });
            },
            writeBuffer(buffer, offset, data) {
                state.bufferWrites.push({
                    buffer,
                    offset,
                    data: data.slice(),
                });
            },
            submit(commands) {
                state.submissions.push(commands);
            },
        },
    };

    return { device, state };
}

function CreateFakeMipmapPipeline() {
    return {
        getBindGroupLayout() {
            return {};
        },
    };
}

test("cube mesh has one UV pair for each vertex", () => {
    const cube = CreateCubeMesh();
    const uvs = cube.GetUVs();

    assert.equal(cube.VertexCount, 36);
    assert.equal(uvs.length, cube.VertexCount * 2);
    assert.deepEqual(cube.Submeshes, [
        { materialSlot: "side", firstVertex: 0, vertexCount: 24 },
        { materialSlot: "top", firstVertex: 24, vertexCount: 6 },
        { materialSlot: "bottom", firstVertex: 30, vertexCount: 6 },
    ]);
    assert.ok(uvs.every((uv) => uv >= 0 && uv <= 1));
    assert.deepEqual(
        Array.from(uvs.slice(0, 12)),
        [0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0],
    );
});

test("renderer prepares draw items from normalized material slots", () => {
    const renderer = new WebGPURenderer({});
    const cube = CreateCubeMesh();
    const materials = {
        side: new Material({ bitmap: {} }),
        top: new Material({ bitmap: {} }),
        bottom: new Material({ bitmap: {} }),
    };
    let resolvedMesh;

    renderer._device = {
        queue: {
            writeBuffer() {},
        },
    };
    renderer._transformBuffer = {};
    renderer._uniformStride = 256;
    renderer._drawCapacity = 1;
    renderer._matrixData = new Float32Array(64);
    renderer._gpuResourceCache = {
        GetMeshResource(mesh) {
            resolvedMesh = mesh;
            return {
                vertexBuffer: {},
                submeshes: mesh.Submeshes,
            };
        },
        GetMaterialBindGroup(material) {
            return { material };
        },
        Prune() {},
    };

    renderer.SetRenderItems(
        [
            {
                mesh: cube,
                materialsBySlot: materials,
                modelMatrix: new Float32Array(16),
            },
        ],
        new Float32Array(16),
        new Float32Array(16),
    );

    assert.deepEqual(
        renderer._drawItems.map((drawItem) => ({
            firstVertex: drawItem.firstVertex,
            vertexCount: drawItem.vertexCount,
            transformOffset: drawItem.transformOffset,
            material: drawItem.materialBindGroup.material,
        })),
        [
            {
                firstVertex: 0,
                vertexCount: 24,
                transformOffset: 0,
                material: materials.side,
            },
            {
                firstVertex: 24,
                vertexCount: 6,
                transformOffset: 0,
                material: materials.top,
            },
            {
                firstVertex: 30,
                vertexCount: 6,
                transformOffset: 0,
                material: materials.bottom,
            },
        ],
    );

    const replacementMesh = CreateCubeMesh();
    const replacementTopMaterial = new Material({ bitmap: {} });
    const replacementMaterials = {
        ...materials,
        top: replacementTopMaterial,
    };

    renderer.SetRenderItems(
        [
            {
                mesh: replacementMesh,
                materialsBySlot: replacementMaterials,
                modelMatrix: new Float32Array(16),
            },
        ],
        new Float32Array(16),
        new Float32Array(16),
    );

    assert.strictEqual(resolvedMesh, replacementMesh);
    assert.strictEqual(
        renderer._drawItems[1].materialBindGroup.material,
        replacementTopMaterial,
    );

    const directMesh = new Mesh(
        new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        new Float32Array(6),
    );
    const directMaterial = new Material({ bitmap: {} });
    renderer.SetRenderItems(
        [
            {
                mesh: directMesh,
                materialsBySlot: { default: directMaterial },
                modelMatrix: new Float32Array(16),
            },
        ],
        new Float32Array(16),
        new Float32Array(16),
    );
    assert.equal(renderer._drawItems.length, 1);
    assert.strictEqual(
        renderer._drawItems[0].materialBindGroup.material,
        directMaterial,
    );
});

test("renderer submits indexed mesh draws with the mesh index format", () => {
    const renderer = new WebGPURenderer({ width: 1, height: 1 });
    const calls = [];
    const renderPass = {
        setPipeline() {},
        setBindGroup() {},
        setVertexBuffer() {},
        setIndexBuffer(buffer, format) {
            calls.push({ type: "index-buffer", buffer, format });
        },
        drawIndexed(indexCount, instanceCount, firstIndex) {
            calls.push({ type: "draw-indexed", indexCount, instanceCount, firstIndex });
        },
        end() {},
    };
    renderer._deviceLostInfo = null;
    renderer.EnsureDepthTexture = () => {};
    renderer._gpuTimingTracker = { BeginFrame: () => null };
    renderer._device = {
        createCommandEncoder() {
            return {
                beginRenderPass: () => renderPass,
                finish: () => ({}),
            };
        },
        queue: { submit() {} },
    };
    renderer._context = {
        getCurrentTexture: () => ({ createView: () => ({}) }),
    };
    renderer._pipeline = {};
    renderer._transformBindGroup = {};
    renderer._drawItems = [{
        vertexBuffer: {},
        indexBuffer: {},
        indexFormat: "uint16",
        indexCount: 3,
        firstIndex: 6,
        transformOffset: 0,
        materialBindGroup: {},
    }];

    renderer.Render();

    assert.deepEqual(calls, [
        { type: "index-buffer", buffer: renderer._drawItems[0].indexBuffer, format: "uint16" },
        { type: "draw-indexed", indexCount: 3, instanceCount: 1, firstIndex: 6 },
    ]);
});

test("mesh rejects UV data with the wrong number of values", () => {
    assert.throws(
        () =>
            new Mesh(
                new Float32Array([
                    0, 0, 0,
                    1, 0, 0,
                    0, 1, 0,
                ]),
                new Float32Array([0, 0]),
            ),
        /one uv pair for each vertex/,
    );
});

test("material acquisition loads and releases its image dependency", async () => {
    const bitmap = {
        width: 4,
        height: 2,
        closeCount: 0,
        close() {
            this.closeCount += 1;
        },
    };

    const catalog = new AssetCatalog();
    catalog.Register({
        id: "texture:grass",
        typeId: "texture",
        loaderId: "image:texture",
        source: {
            kind: "image",
            url: "/assets/textures/grass.jpg",
        },
        version: 1,
        dependencies: [],
    });
    catalog.Register({
        id: "material:grass",
        typeId: "material",
        loaderId: "basic:material",
        source: {
            kind: "material",
            baseColorTextureAssetId: "texture:grass",
        },
        version: 1,
        dependencies: ["texture:grass"],
    });

    const loaderRegistry = new AssetLoaderRegistry();
    loaderRegistry.Register(
        "image:texture",
        new ImageTextureLoader(
            async () => ({
                ok: true,
                async blob() {
                    return {};
                },
            }),
            async () => bitmap,
        ),
    );
    loaderRegistry.Register(
        "basic:material",
        new MaterialLoader(),
    );

    const manager = new AssetManager(catalog, loaderRegistry);
    const lease = await manager.Acquire("material:grass");

    assert.ok(lease.Asset instanceof Material);
    assert.strictEqual(lease.Asset.BaseColorTexture.bitmap, bitmap);
    assert.equal(bitmap.closeCount, 0);

    await lease.Release();

    assert.equal(bitmap.closeCount, 1);
});

test("GPU texture upload includes required usages and reuses its cache entry", () => {
    WithGpuUsage(() => {
        const { device, state } = CreateFakeDevice();
        const bitmap = {};
        const imageAsset = {
            bitmap,
            width: 16,
            height: 8,
        };
        const trackedBytes = [];
        const resourceCache = new WebGpuResourceCache({
            device,
            materialBindGroupLayout: {},
            textureSampler: {},
            mipmapPipeline: CreateFakeMipmapPipeline(),
            trackGpuResource: (_label, _resourceType, bytes) => {
                trackedBytes.push(bytes);
                return null;
            },
            destroyGpuResource: (resource) => resource?.destroy(),
        });

        const first = resourceCache.GetTextureResource(imageAsset);
        const second = resourceCache.GetTextureResource(imageAsset);

        assert.strictEqual(first, second);
        assert.equal(state.textureDescriptors.length, 1);
        assert.equal(state.textureDescriptors[0].mipLevelCount, 5);
        assert.equal(
            state.textureDescriptors[0].usage,
            globalThis.GPUTextureUsage.TEXTURE_BINDING |
                globalThis.GPUTextureUsage.COPY_DST |
                globalThis.GPUTextureUsage.RENDER_ATTACHMENT,
        );

        assert.equal(state.copies.length, 1);
        assert.strictEqual(state.copies[0].source.source, bitmap);
        assert.strictEqual(
            state.copies[0].destination.texture,
            state.textures[0],
        );
        assert.deepEqual(state.copies[0].size, [16, 8, 1]);
        assert.equal(state.renderPasses.length, 4);
        assert.deepEqual(
            state.renderPasses.map(({ descriptor }) =>
                descriptor.colorAttachments[0].view.descriptor.baseMipLevel,
            ),
            [1, 2, 3, 4],
        );
        assert.ok(state.renderPasses.every((pass) =>
            pass.ended && pass.drawVertexCount === 3,
        ));
        assert.equal(state.submissions.length, 1);
        assert.deepEqual(trackedBytes, [684]);
    });
});

test("GPU mesh upload preserves indexed geometry", () => {
    WithGpuUsage(() => {
        globalThis.GPUBufferUsage.VERTEX = 4;
        globalThis.GPUBufferUsage.INDEX = 8;
        const { device, state } = CreateFakeDevice();
        const resourceCache = new WebGpuResourceCache({
            device,
            materialBindGroupLayout: {},
            textureSampler: {},
            mipmapPipeline: CreateFakeMipmapPipeline(),
            trackGpuResource: () => null,
            destroyGpuResource: (resource) => resource?.destroy(),
        });
        const mesh = new Mesh(
            new Float32Array([
                0, 0, 0,
                1, 0, 0,
                0, 1, 0,
            ]),
            new Float32Array(6),
            null,
            new Uint16Array([0, 1, 2]),
        );

        const meshResource = resourceCache.GetMeshResource(mesh);
        assert.equal(meshResource.indexFormat, "uint16");
        assert.equal(meshResource.indexCount, 3);
        assert.deepEqual(
            Array.from(state.bufferWrites[1].data),
            [0, 1, 2],
        );
        assert.equal(
            state.buffers[1].descriptor.usage,
            globalThis.GPUBufferUsage.INDEX | globalThis.GPUBufferUsage.COPY_DST,
        );
        resourceCache.Dispose();
        assert.ok(state.buffers.every((buffer) => buffer.destroyCount === 1));
    });
});

test("material bind group is cached and connects texture and sampler", () => {
    WithGpuUsage(() => {
        const { device, state } = CreateFakeDevice();
        const layout = {};
        const sampler = {};
        const linearSampler = {};
        const imageAsset = {
            bitmap: {},
            width: 4,
            height: 4,
        };
        const material = new Material(imageAsset);
        const resourceCache = new WebGpuResourceCache({
            device,
            materialBindGroupLayout: layout,
            textureSampler: sampler,
            linearTextureSampler: linearSampler,
            mipmapPipeline: CreateFakeMipmapPipeline(),
            trackGpuResource: () => null,
            destroyGpuResource: (resource) => resource?.destroy(),
        });

        const first = resourceCache.GetMaterialBindGroup(material);
        const second = resourceCache.GetMaterialBindGroup(material);
        const materialBindGroupDescriptor = state.bindGroupDescriptors.find(
            ({ layout: bindGroupLayout }) => bindGroupLayout === layout,
        );

        assert.strictEqual(first, second);
        assert.ok(materialBindGroupDescriptor);
        assert.strictEqual(
            materialBindGroupDescriptor.layout,
            layout,
        );
        assert.strictEqual(
            materialBindGroupDescriptor.entries[0].resource.texture,
            state.textures[0],
        );
        assert.strictEqual(
            materialBindGroupDescriptor.entries[1].resource,
            sampler,
        );
        assert.equal(materialBindGroupDescriptor.entries[2].binding, 2);
        assert.deepEqual(Array.from(state.bufferWrites[0].data), [1, 1, 1, 1]);

        const linearMaterial = new Material(imageAsset, {
            baseColorMinFilter: "linear",
        });
        resourceCache.GetMaterialBindGroup(linearMaterial);
        const linearBindGroup = state.bindGroupDescriptors.find(
            ({ layout: bindGroupLayout, entries }) =>
                bindGroupLayout === layout && entries[1].resource === linearSampler,
        );
        assert.ok(linearBindGroup);
    });
});

test("material without a texture uses a cached white texture and base color factor", () => {
    WithGpuUsage(() => {
        const { device, state } = CreateFakeDevice();
        const resourceCache = new WebGpuResourceCache({
            device,
            materialBindGroupLayout: {},
            textureSampler: {},
            mipmapPipeline: CreateFakeMipmapPipeline(),
            trackGpuResource: () => null,
            destroyGpuResource: (resource) => resource?.destroy(),
        });
        const material = new Material(null, {
            baseColorFactor: [0.25, 0.5, 0.75, 1],
        });

        resourceCache.GetMaterialBindGroup(material);
        assert.equal(state.textureWrites.length, 1);
        assert.deepEqual(
            Array.from(state.textureWrites[0].data),
            [255, 255, 255, 255],
        );
        assert.deepEqual(
            Array.from(state.bufferWrites[0].data),
            [0.25, 0.5, 0.75, 1],
        );

        resourceCache.Dispose();
        assert.equal(state.textures[0].destroyCount, 1);
        assert.equal(state.buffers[0].destroyCount, 1);
    });
});

test("resource cache releases GPU textures unused by active materials", () => {
    const resourceCache = new WebGpuResourceCache({
        device: {},
        materialBindGroupLayout: {},
        textureSampler: {},
        mipmapPipeline: CreateFakeMipmapPipeline(),
        trackGpuResource: () => null,
        destroyGpuResource: (resource) => resource?.destroy(),
    });
    const activeImage = { bitmap: {}, width: 2, height: 2 };
    const inactiveImage = { bitmap: {}, width: 2, height: 2 };
    const activeMaterial = new Material(activeImage);
    const inactiveMaterial = new Material(inactiveImage);
    const activeTexture = {
        destroyCount: 0,
        destroy() {
            this.destroyCount += 1;
        },
    };
    const inactiveTexture = {
        destroyCount: 0,
        destroy() {
            this.destroyCount += 1;
        },
    };

    resourceCache._textureResources.set(activeImage, {
        texture: activeTexture,
    });
    resourceCache._textureResources.set(inactiveImage, {
        texture: inactiveTexture,
    });
    resourceCache._materialBindGroups.set(activeMaterial, {});
    resourceCache._materialBindGroups.set(inactiveMaterial, {});

    resourceCache.Prune(new Set(), new Set([activeMaterial]));

    assert.equal(activeTexture.destroyCount, 0);
    assert.equal(inactiveTexture.destroyCount, 1);
    assert.equal(resourceCache._textureResources.has(activeImage), true);
    assert.equal(resourceCache._textureResources.has(inactiveImage), false);
    assert.equal(resourceCache._materialBindGroups.has(activeMaterial), true);
    assert.equal(resourceCache._materialBindGroups.has(inactiveMaterial), false);
});
