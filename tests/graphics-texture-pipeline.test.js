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

function CreateLoadedHandle(assetId, asset) {
    const handle = new AssetHandle(assetId);
    handle._Replace(asset);
    return handle;
}

function WithGpuTextureUsage(callback) {
    const previous = Object.getOwnPropertyDescriptor(
        globalThis,
        "GPUTextureUsage",
    );

    Object.defineProperty(globalThis, "GPUTextureUsage", {
        configurable: true,
        value: {
            TEXTURE_BINDING: 1,
            COPY_DST: 2,
            RENDER_ATTACHMENT: 4,
        },
        writable: true,
    });

    try {
        return callback();
    } finally {
        if (previous) {
            Object.defineProperty(
                globalThis,
                "GPUTextureUsage",
                previous,
            );
        } else {
            Reflect.deleteProperty(globalThis, "GPUTextureUsage");
        }
    }
}

function CreateFakeDevice() {
    const state = {
        textureDescriptors: [],
        textures: [],
        copies: [],
        bindGroupDescriptors: [],
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

            texture.view = { texture };
            texture.createView = () => texture.view;

            state.textureDescriptors.push(descriptor);
            state.textures.push(texture);
            return texture;
        },

        createBindGroup(descriptor) {
            const bindGroup = { descriptor };
            state.bindGroupDescriptors.push(descriptor);
            return bindGroup;
        },

        queue: {
            copyExternalImageToTexture(source, destination, size) {
                state.copies.push({ source, destination, size });
            },
        },
    };

    return { device, state };
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

test("renderer resolves current handles into draw items per material slot", () => {
    const renderer = new WebGPURenderer({});
    const cube = CreateCubeMesh();
    const meshHandle = CreateLoadedHandle("builtin:cube", cube);
    const materials = {
        side: new Material({ bitmap: {} }),
        top: new Material({ bitmap: {} }),
        bottom: new Material({ bitmap: {} }),
    };
    const materialHandlesBySlot = Object.fromEntries(
        Object.entries(materials).map(([materialSlot, material]) => [
            materialSlot,
            CreateLoadedHandle(`material:${materialSlot}`, material),
        ]),
    );
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
    renderer._GetMeshResource = (mesh) => {
        resolvedMesh = mesh;
        return {
            vertexBuffer: {},
            submeshes: mesh.Submeshes,
        };
    };
    renderer._GetMaterialBindGroup = (material) => ({ material });
    renderer._PruneMeshResources = () => {};
    renderer._PruneMaterialResources = () => {};

    renderer.SetRenderItems(
        [
            {
                meshHandle,
                materialHandlesBySlot,
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
    meshHandle._Replace(replacementMesh);
    materialHandlesBySlot.top._Replace(replacementTopMaterial);

    renderer.SetRenderItems(
        [
            {
                meshHandle,
                materialHandlesBySlot,
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
    WithGpuTextureUsage(() => {
        const renderer = new WebGPURenderer({});
        const { device, state } = CreateFakeDevice();
        const bitmap = {};
        const imageAsset = {
            bitmap,
            width: 16,
            height: 8,
        };

        renderer._device = device;

        const first = renderer._GetTextureResource(imageAsset);
        const second = renderer._GetTextureResource(imageAsset);

        assert.strictEqual(first, second);
        assert.equal(state.textureDescriptors.length, 1);
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
    });
});

test("material bind group is cached and connects texture and sampler", () => {
    WithGpuTextureUsage(() => {
        const renderer = new WebGPURenderer({});
        const { device, state } = CreateFakeDevice();
        const layout = {};
        const sampler = {};
        const imageAsset = {
            bitmap: {},
            width: 4,
            height: 4,
        };
        const material = new Material(imageAsset);

        renderer._device = device;
        renderer._materialBindGroupLayout = layout;
        renderer._textureSampler = sampler;

        const first = renderer._GetMaterialBindGroup(material);
        const second = renderer._GetMaterialBindGroup(material);

        assert.strictEqual(first, second);
        assert.equal(state.bindGroupDescriptors.length, 1);
        assert.strictEqual(
            state.bindGroupDescriptors[0].layout,
            layout,
        );
        assert.strictEqual(
            state.bindGroupDescriptors[0].entries[0].resource,
            state.textures[0].view,
        );
        assert.strictEqual(
            state.bindGroupDescriptors[0].entries[1].resource,
            sampler,
        );
    });
});

test("renderer destroys GPU textures unused by active materials", () => {
    const renderer = new WebGPURenderer({});
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

    renderer._textureResources.set(activeImage, {
        texture: activeTexture,
    });
    renderer._textureResources.set(inactiveImage, {
        texture: inactiveTexture,
    });
    renderer._materialBindGroups.set(activeMaterial, {});
    renderer._materialBindGroups.set(inactiveMaterial, {});

    renderer._PruneMaterialResources(new Set([activeMaterial]));

    assert.equal(activeTexture.destroyCount, 0);
    assert.equal(inactiveTexture.destroyCount, 1);
    assert.equal(renderer._textureResources.has(activeImage), true);
    assert.equal(renderer._textureResources.has(inactiveImage), false);
    assert.equal(renderer._materialBindGroups.has(activeMaterial), true);
    assert.equal(renderer._materialBindGroups.has(inactiveMaterial), false);
});
