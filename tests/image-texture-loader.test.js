import assert from "node:assert/strict";
import test from "node:test";
import { AssetCatalog } from "../src/core/assets/asset-catalog.js";
import { AssetLoaderRegistry } from "../src/core/assets/asset-loader-registry.js";
import { AssetManager } from "../src/core/assets/asset-manager.js";
import { ImageTextureLoader } from "../src/graphics/assets/image-texture-loader.js";

function CreateDescriptor(source) {
    return {
        id: "texture:test",
        typeId: "texture",
        loaderId: "image:texture",
        source,
        version: 1,
        dependencies: [],
    };
}

test("loads an image and releases it after the final asset lease", async () => {
    const blob = {};
    let requestedUrl;
    let receivedBlob;
    let closeCount = 0;

    const bitmap = {
        width: 8,
        height: 4,
        close() {
            closeCount += 1;
        },
    };

    const loader = new ImageTextureLoader(
        async (url) => {
            requestedUrl = url;

            return {
                ok: true,
                status: 200,
                async blob() {
                    return blob;
                },
            };
        },
        async (imageBlob) => {
            receivedBlob = imageBlob;
            return bitmap;
        },
    );

    const catalog = new AssetCatalog();
    catalog.Register(
        CreateDescriptor({
            kind: "image",
            url: "/assets/textures/grass.jpg",
        }),
    );

    const loaderRegistry = new AssetLoaderRegistry();
    loaderRegistry.Register("image:texture", loader);

    const manager = new AssetManager(catalog, loaderRegistry);

    const [firstLease, secondLease] = await Promise.all([
        manager.Acquire("texture:test"),
        manager.Acquire("texture:test"),
    ]);

    assert.equal(requestedUrl, "/assets/textures/grass.jpg");
    assert.strictEqual(receivedBlob, blob);
    assert.strictEqual(firstLease.Asset.bitmap, bitmap);
    assert.equal(firstLease.Asset.width, 8);
    assert.equal(firstLease.Asset.height, 4);

    await firstLease.Release();
    assert.equal(closeCount, 0);

    await secondLease.Release();
    assert.equal(closeCount, 1);
});

test("rejects an image request with an HTTP error", async () => {
    let decodeCount = 0;

    const loader = new ImageTextureLoader(
        async () => ({
            ok: false,
            status: 404,
        }),
        async () => {
            decodeCount += 1;
            return {};
        },
    );

    await assert.rejects(
        loader.Load(
            CreateDescriptor({
                kind: "image",
                url: "/missing.jpg",
            }),
        ),
        /HTTP 404/,
    );

    assert.equal(decodeCount, 0);
});

test("rejects descriptors that are not image sources", async () => {
    const loader = new ImageTextureLoader(
        async () => {
            throw new Error("Fetch should not run.");
        },
        async () => {
            throw new Error("Decode should not run.");
        },
    );

    await assert.rejects(
        loader.Load(
            CreateDescriptor({
                kind: "primitive",
                name: "cube",
            }),
        ),
        /requires an image source/,
    );
});
