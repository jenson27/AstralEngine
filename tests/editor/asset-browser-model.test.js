import assert from "node:assert/strict";
import test from "node:test";
import {
    FilterAssetEntries,
    FormatAssetFileSize,
    GetAssetFileTypeLabel,
    GetAssetFileUrl,
} from "../../src/editor/panels/asset-browser/asset-browser-model.js";

test("filters by case-insensitive name and type while keeping folders visible", () => {
    const entries = [
        { name: "textures", kind: "directory", type: "folder" },
        { name: "Grass.PNG", kind: "file", type: "image" },
        { name: "Enemy.glb", kind: "file", type: "glb" },
    ];

    assert.deepEqual(
        FilterAssetEntries(entries, {
            searchText: "  grass ",
            typeFilter: "image",
        }),
        [entries[1]],
    );
    assert.deepEqual(
        FilterAssetEntries(entries, { typeFilter: "glb" }),
        [entries[0], entries[2]],
    );
});

test("formats supported and unknown file types", () => {
    assert.equal(GetAssetFileTypeLabel("model"), "3D model");
    assert.equal(GetAssetFileTypeLabel("glb"), "GLB model");
    assert.equal(GetAssetFileTypeLabel("unknown"), "Other");
});

test("formats file sizes", () => {
    assert.equal(FormatAssetFileSize(0), "0 bytes");
    assert.equal(FormatAssetFileSize(1023), "1023 bytes");
    assert.match(
        FormatAssetFileSize(1024),
        /^1\.0 KiB \(.+ bytes\)$/,
    );
    assert.equal(FormatAssetFileSize(-1), "Unknown size");
});

test("encodes each asset URL path segment", () => {
    assert.equal(
        GetAssetFileUrl("textures/my folder/a#b.png"),
        "/assets/textures/my%20folder/a%23b.png",
    );
});
