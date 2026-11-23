import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AssetCatalog } from "../src/core/assets/asset-catalog.js";
import { AssetLoaderRegistry } from "../src/core/assets/asset-loader-registry.js";
import { AssetManager } from "../src/core/assets/asset-manager.js";
import { MemoryTracker } from "../src/diagnostics/profiling/memory-tracker.js";
import { Profiler } from "../src/diagnostics/profiling/profiler.js";
import { GlbModelLoader } from "../src/graphics/assets/glb-model-loader.js";
import { ModelAsset } from "../src/graphics/model-asset.js";

const TEST_PNG_BYTES = Uint8Array.from(
    Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=",
        "base64",
    ),
);

function BuildGlb({
    imageUri = null,
    extensionsRequired = [],
    minFilter = null,
    sampler = null,
    mode = null,
    includeTexCoord1 = false,
    includeColors = false,
    materialDefinition = null,
    animations = null,
    nodes = [{ mesh: 0, translation: [3, 0, 0] }],
    sceneNodes = nodes.map((_node, index) => index),
} = {}) {
    const binaryParts = [];
    let binaryLength = 0;

    function AddBinaryPart(bytes) {
        while (binaryLength % 4 !== 0) {
            binaryParts.push(new Uint8Array([0]));
            binaryLength += 1;
        }
        const byteOffset = binaryLength;
        binaryParts.push(bytes);
        binaryLength += bytes.byteLength;
        return { byteOffset, byteLength: bytes.byteLength };
    }

    const positions = AddBinaryPart(
        new Uint8Array(new Float32Array([
            0, 0, 0,
            1, 0, 0,
            0, 1, 0,
        ]).buffer),
    );
    const uvs = AddBinaryPart(
        new Uint8Array(new Float32Array([
            0, 0,
            1, 0,
            0, 1,
        ]).buffer),
    );
    const indices = AddBinaryPart(
        new Uint8Array(new Uint16Array([0, 1, 2]).buffer),
    );
    const image = AddBinaryPart(TEST_PNG_BYTES);
    const colors = includeColors
        ? AddBinaryPart(Uint8Array.from([
            255, 0, 0, 255,
            0, 255, 0, 255,
            0, 0, 255, 255,
        ]))
        : null;
    const declaredBufferLength = binaryLength;

    while (binaryLength % 4 !== 0) {
        binaryParts.push(new Uint8Array([0]));
        binaryLength += 1;
    }
    const binaryBytes = new Uint8Array(binaryLength);
    let binaryOffset = 0;
    for (const part of binaryParts) {
        binaryBytes.set(part, binaryOffset);
        binaryOffset += part.byteLength;
    }

    const document = {
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: sceneNodes }],
        nodes,
        meshes: [{
            primitives: [{
                attributes: {
                    POSITION: 0,
                    TEXCOORD_0: 1,
                    ...(includeTexCoord1 ? { TEXCOORD_1: 1 } : {}),
                    ...(includeColors ? { COLOR_0: 3 } : {}),
                },
                indices: 2,
                material: 0,
                ...(mode === null ? {} : { mode }),
            }],
        }],
        materials: [materialDefinition ?? {
            name: "Test material",
            pbrMetallicRoughness: {
                baseColorFactor: [0.5, 0.75, 1, 1],
                baseColorTexture: { index: 0 },
            },
        }],
        textures: [{
            source: 0,
            ...(minFilter === null && sampler === null ? {} : { sampler: 0 }),
        }],
        ...(sampler === null && minFilter === null
            ? {}
            : { samplers: [sampler ?? { minFilter }] }),
        ...(animations === null ? {} : { animations }),
        images: imageUri === null
            ? [{ bufferView: 3, mimeType: "image/png" }]
            : [{ uri: imageUri }],
        ...(extensionsRequired.length > 0
            ? { extensionsUsed: extensionsRequired, extensionsRequired }
            : {}),
        buffers: [{ byteLength: declaredBufferLength }],
        bufferViews: [
            { buffer: 0, ...positions, target: 34962 },
            { buffer: 0, ...uvs, target: 34962 },
            { buffer: 0, ...indices, target: 34963 },
            { buffer: 0, ...image },
            ...(colors === null ? [] : [{ buffer: 0, ...colors, target: 34962 }]),
        ],
        accessors: [
            { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
            { bufferView: 1, componentType: 5126, count: 3, type: "VEC2" },
            { bufferView: 2, componentType: 5123, count: 3, type: "SCALAR" },
            ...(includeColors
                ? [{ bufferView: 4, componentType: 5121, count: 3, type: "VEC4", normalized: true }]
                : []),
        ],
    };

    const jsonBytes = new TextEncoder().encode(JSON.stringify(document));
    const paddedJsonLength = Math.ceil(jsonBytes.byteLength / 4) * 4;
    const paddedJson = new Uint8Array(paddedJsonLength).fill(0x20);
    paddedJson.set(jsonBytes);

    const totalLength = 12 + 8 + paddedJson.byteLength + 8 + binaryBytes.byteLength;
    const glb = new ArrayBuffer(totalLength);
    const view = new DataView(glb);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, totalLength, true);
    view.setUint32(12, paddedJson.byteLength, true);
    view.setUint32(16, 0x4e4f534a, true);
    new Uint8Array(glb, 20, paddedJson.byteLength).set(paddedJson);
    const binHeaderOffset = 20 + paddedJson.byteLength;
    view.setUint32(binHeaderOffset, binaryBytes.byteLength, true);
    view.setUint32(binHeaderOffset + 4, 0x004e4942, true);
    new Uint8Array(glb, binHeaderOffset + 8).set(binaryBytes);
    return glb;
}

function CreateManager(loader, memoryTracker = null, importScale = undefined) {
    const catalog = new AssetCatalog();
    catalog.RegisterManifest({
        format: "astral-assets",
        version: 1,
        assets: [{
            id: "model:test",
            typeId: "model",
            loaderId: "gltf:glb",
            source: {
                kind: "glb",
                url: "/assets/models/test.glb",
                ...(importScale === undefined ? {} : { importScale }),
            },
            version: 1,
            dependencies: [],
        }],
    });
    const loaderRegistry = new AssetLoaderRegistry();
    loaderRegistry.Register("gltf:glb", loader);
    return new AssetManager(catalog, loaderRegistry, memoryTracker);
}

test("loads a static GLB through the asset manager with texture and material data", async () => {
    const glb = BuildGlb();
    let closeCount = 0;
    const bitmap = {
        width: 2,
        height: 2,
        close() {
            closeCount += 1;
        },
    };
    const memoryTracker = new MemoryTracker();
    const profiler = new Profiler();
    profiler.BeginFrame(1);
    const manager = CreateManager(
        new GlbModelLoader(
            async () => ({ ok: true, arrayBuffer: async () => glb }),
            async (blob) => {
                assert.equal(blob.type, "image/png");
                return bitmap;
            },
            undefined,
            profiler,
        ),
        memoryTracker,
    );

    const lease = await manager.Acquire("model:test");
    const model = lease.Asset;

    assert.ok(model instanceof ModelAsset);
    assert.equal(model.Primitives.length, 1);
    assert.deepEqual(
        Array.from(model.Primitives[0].mesh.GetPositions()),
        [0, 0, 0, 1, 0, 0, 0, 1, 0],
    );
    assert.deepEqual(
        Array.from(model.Primitives[0].mesh.GetIndices()),
        [0, 1, 2],
    );
    assert.equal(model.Primitives[0].transform[12], 3);
    assert.deepEqual(
        Array.from(model.Primitives[0].mesh.GetUVs()),
        [0, 0, 1, 0, 0, 1],
    );
    assert.deepEqual(model.Primitives[0].material.BaseColorFactor, [
        0.5,
        0.75,
        1,
        1,
    ]);
    assert.equal(
        model.Primitives[0].material.BaseColorMinFilter,
        "linear-mipmap-linear",
    );
    assert.strictEqual(model.Primitives[0].material.BaseColorTexture.bitmap, bitmap);
    assert.equal(model.Images.length, 1);
    assert.equal(model.MemoryUsageBytes, model.Primitives[0].mesh.MemoryUsageBytes + 16);
    assert.equal(model.MemoryUsageEstimated, true);

    const trackedModelMemory = memoryTracker.GetLiveResources().find(
        ({ label }) => label === "Asset model:test",
    );
    assert.equal(trackedModelMemory.bytes, model.MemoryUsageBytes);
    assert.equal(trackedModelMemory.estimated, true);

    const profileFrame = profiler.EndFrame();
    const loadScope = profileFrame.scopes.find(
        ({ name }) => name === "GLB.Load:model:test",
    );
    assert.equal(loadScope.category, "asset");
    assert.equal(loadScope.isAsync, true);

    await lease.Release();
    assert.equal(closeCount, 1);
    assert.equal(memoryTracker.GetLiveResources().length, 0);
});

test("loads common static PBR attributes, sampler settings, mask alpha, and import scale", async () => {
    const glb = BuildGlb({
        mode: 5,
        includeTexCoord1: true,
        includeColors: true,
        sampler: {
            wrapS: 33071,
            wrapT: 33648,
            magFilter: 9728,
            minFilter: 9986,
        },
        materialDefinition: {
            name: "PBR mask",
            alphaMode: "MASK",
            alphaCutoff: 0.35,
            extensions: { KHR_materials_unlit: {} },
            pbrMetallicRoughness: {
                baseColorFactor: [0.7, 0.6, 0.5, 1],
                baseColorTexture: { index: 0, texCoord: 1 },
                metallicFactor: 0.4,
                roughnessFactor: 0.6,
                metallicRoughnessTexture: { index: 0 },
            },
        },
    });
    const manager = CreateManager(
        new GlbModelLoader(
            async () => ({ ok: true, arrayBuffer: async () => glb }),
            async () => ({ width: 1, height: 1, close() {} }),
        ),
        null,
        0.01,
    );

    const lease = await manager.Acquire("model:test");
    const { mesh, material, transform } = lease.Asset.Primitives[0];
    assert.ok(Math.abs(transform[12] - 0.03) < 1e-6);
    assert.deepEqual(Array.from(mesh.GetIndices()), [0, 1, 2]);
    assert.deepEqual(Array.from(mesh.GetNormals()), [0, 0, 1, 0, 0, 1, 0, 0, 1]);
    assert.deepEqual(Array.from(mesh.GetTexCoord1()), [0, 0, 1, 0, 0, 1]);
    assert.deepEqual(Array.from(mesh.GetColors()), [
        1, 0, 0, 1,
        0, 1, 0, 1,
        0, 0, 1, 1,
    ]);
    assert.equal(material.MetallicFactor, 0.4);
    assert.equal(material.RoughnessFactor, 0.6);
    assert.equal(material.BaseColorTexCoord, 1);
    assert.equal(material.AlphaMode, "MASK");
    assert.equal(material.AlphaCutoff, 0.35);
    assert.equal(material.IsUnlit, true);
    assert.equal(material.BaseColorSampler.addressModeU, "clamp-to-edge");
    assert.equal(material.BaseColorSampler.addressModeV, "mirror-repeat");
    assert.equal(material.BaseColorSampler.magFilter, "nearest");
    assert.equal(material.BaseColorSampler.minFilter, "nearest");
    assert.equal(material.BaseColorSampler.mipmapFilter, "linear");
    assert.equal(material.BaseColorSampler.mipmaps, true);
    assert.strictEqual(material.BaseColorTexture, material.MetallicRoughnessTexture);
    await lease.Release();
});

test("converts triangle fans to indexed triangle lists", async () => {
    const manager = CreateManager(
        new GlbModelLoader(
            async () => ({ ok: true, arrayBuffer: async () => BuildGlb({ mode: 6 }) }),
            async () => ({ width: 1, height: 1, close() {} }),
        ),
    );
    const lease = await manager.Acquire("model:test");
    assert.deepEqual(Array.from(lease.Asset.Primitives[0].mesh.GetIndices()), [0, 1, 2]);
    await lease.Release();
});

test("maps GLB linear minification to the non-mipmapped material mode", async () => {
    const glb = BuildGlb({ minFilter: 9729 });
    const manager = CreateManager(
        new GlbModelLoader(
            async () => ({ ok: true, arrayBuffer: async () => glb }),
            async () => ({ width: 1, height: 1, close() {} }),
        ),
    );

    const lease = await manager.Acquire("model:test");
    assert.equal(
        lease.Asset.Primitives[0].material.BaseColorMinFilter,
        "linear",
    );
    await lease.Release();
});

test("shares indexed mesh data across nodes and keeps nested transforms", async () => {
    const glb = BuildGlb({
        nodes: [
            { translation: [3, 0, 0], children: [1] },
            {
                mesh: 0,
                translation: [0, 2, 0],
                rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
                scale: [2, 3, 1],
            },
            { mesh: 0, translation: [0, 0, 4] },
        ],
        sceneNodes: [0, 2],
    });
    const manager = CreateManager(
        new GlbModelLoader(
            async () => ({ ok: true, arrayBuffer: async () => glb }),
            async () => ({ width: 1, height: 1, close() {} }),
        ),
    );

    const lease = await manager.Acquire("model:test");
    const [nestedPrimitive, secondPrimitive] = lease.Asset.Primitives;
    assert.strictEqual(nestedPrimitive.mesh, secondPrimitive.mesh);
    assert.equal(nestedPrimitive.transform[12], 3);
    assert.equal(nestedPrimitive.transform[13], 2);
    assert.ok(Math.abs(nestedPrimitive.transform[0]) < 1e-6);
    assert.ok(Math.abs(nestedPrimitive.transform[1] - 2) < 1e-6);
    assert.ok(Math.abs(nestedPrimitive.transform[4] + 3) < 1e-6);
    assert.equal(secondPrimitive.transform[14], 4);
    await lease.Release();
});

test("decodes percent-encoded image data URI bytes without UTF-8 conversion", async () => {
    const imageUri = "data:image/png," + Array.from(
        TEST_PNG_BYTES,
        (byte) => "%" + byte.toString(16).padStart(2, "0"),
    ).join("");
    const glb = BuildGlb({ imageUri });
    const manager = CreateManager(
        new GlbModelLoader(
            async () => ({ ok: true, arrayBuffer: async () => glb }),
            async (blob) => {
                assert.equal(blob.type, "image/png");
                assert.deepEqual(
                    new Uint8Array(await blob.arrayBuffer()),
                    TEST_PNG_BYTES,
                );
                return { width: 1, height: 1, close() {} };
            },
        ),
    );

    const lease = await manager.Acquire("model:test");
    assert.equal(lease.Asset.Images.length, 1);
    await lease.Release();
});

test("rejects required punctual light extension when static loader skips lights", async () => {
    const glb = BuildGlb({
        extensionsRequired: ["KHR_lights_punctual"],
    });
    const manager = CreateManager(
        new GlbModelLoader(
            async () => ({ ok: true, arrayBuffer: async () => glb }),
            async () => ({ width: 1, height: 1, close() {} }),
        ),
    );

    await assert.rejects(
        manager.Acquire("model:test"),
        /requires unsupported extensions: KHR_lights_punctual/,
    );
});

test("loads the registered Die6 GLB from the version 1 manifest", async () => {
    const manifest = JSON.parse(
        await readFile(new URL("../assets/asset-manifest.json", import.meta.url), "utf8"),
    );
    const descriptor = manifest.assets.find((asset) => asset.id === "model:die6");
    assert.ok(descriptor);

    const file = await readFile(new URL("../assets/models/Die6.glb", import.meta.url));
    const glb = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    const catalog = new AssetCatalog();
    catalog.RegisterManifest(manifest);
    const loaders = new AssetLoaderRegistry();
    loaders.Register(
        "gltf:glb",
        new GlbModelLoader(
            async (url) => {
                assert.equal(url, descriptor.source.url);
                return { ok: true, arrayBuffer: async () => glb };
            },
            async (blob) => {
                assert.equal(blob.type, "image/png");
                assert.ok(blob.size > 0);
                return { width: 4, height: 4, close() {} };
            },
        ),
    );
    const manager = new AssetManager(catalog, loaders);

    const lease = await manager.Acquire(descriptor.id);
    assert.equal(lease.Asset.Primitives.length, 1);
    assert.equal(lease.Asset.Primitives[0].material.Name, "Die6Mat");
    assert.equal(lease.Asset.Images.length, 1);
    await lease.Release();
});

test("reports corrupt GLB data with an asset-specific error", async () => {
    const invalidGlb = BuildGlb();
    new DataView(invalidGlb).setUint32(0, 0, true);
    const manager = CreateManager(
        new GlbModelLoader(
            async () => ({ ok: true, arrayBuffer: async () => invalidGlb }),
            async () => {
                throw new Error("The invalid file must fail before image decoding.");
            },
        ),
    );

    await assert.rejects(manager.Acquire("model:test"), (error) =>
        error.message.includes(
            'Failed to load asset "model:test": GLB asset "model:test" failed during read GLB container: GLB header has an invalid magic value',
        ),
    );
});

test("reports a missing GLB file with its HTTP status", async () => {
    const manager = CreateManager(
        new GlbModelLoader(async () => ({ ok: false, status: 404 })),
    );

    await assert.rejects(manager.Acquire("model:test"), (error) =>
        error.message.includes(
            'Failed to load asset "model:test": GLB asset "model:test" failed during fetch GLB: Could not fetch GLB. HTTP 404.',
        ),
    );
});

test("skips unsupported animation data while loading static content", async () => {
    const updatedGlb = BuildGlb({ animations: [{ samplers: [], channels: [] }] });
    const manager = CreateManager(
        new GlbModelLoader(
            async () => ({ ok: true, arrayBuffer: async () => updatedGlb }),
            async () => ({ width: 1, height: 1, close() {} }),
        ),
    );
    const lease = await manager.Acquire("model:test");
    assert.equal(lease.Asset.Primitives.length, 1);
    await lease.Release();
});

test("test GLB fixture uses binary chunks rather than a text file", () => {
    const glb = BuildGlb();
    assert.equal(new DataView(glb).getUint32(0, true), 0x46546c67);
    assert.equal(Buffer.from(glb).subarray(0, 4).toString("ascii"), "glTF");
});
