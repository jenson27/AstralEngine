import assert from "node:assert/strict";
import test from "node:test";
import { AssetCatalog } from "../src/core/assets/asset-catalog.js";

test("maps source URLs to all matching asset IDs", () => {
    const catalog = new AssetCatalog();

    catalog.RegisterManifest({
        format: "astral-assets",
        version: 1,
        assets: [
            {
                id: "texture:grass",
                typeId: "texture",
                loaderId: "image:texture",
                source: {
                    kind: "image",
                    url: "/assets/textures/grass.jpg?revision=1",
                },
                version: 1,
            },
            {
                id: "texture:grass-alias",
                typeId: "texture",
                loaderId: "image:texture",
                source: {
                    kind: "image",
                    url: "/assets/textures/grass.jpg",
                },
                version: 1,
            },
            {
                id: "texture:remote",
                typeId: "texture",
                loaderId: "image:texture",
                source: {
                    kind: "image",
                    url: "https://cdn.example.test/grass.jpg",
                },
                version: 1,
            },
        ],
    });

    const assetIds = catalog.GetAssetIdsBySourcePath(
        "/assets/textures/grass.jpg",
    );

    assert.deepEqual(assetIds, [
        "texture:grass",
        "texture:grass-alias",
    ]);
    assert.ok(Object.isFrozen(assetIds));
    assert.deepEqual(
        catalog.GetAssetIdsBySourcePath(
            "https://cdn.example.test/grass.jpg",
        ),
        [],
    );
    assert.deepEqual(catalog.GetAssetIdsBySourcePath(""), []);
});
