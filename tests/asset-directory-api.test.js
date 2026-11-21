import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const fs = require("node:fs/promises");
const { HandleAssetDirectoryRequest } = require(
    "../server/asset-directory-api.cjs",
);

async function CreateAssetRoot(context) {
    const temporaryRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), "astral-asset-browser-"),
    );
    const assetRoot = path.join(temporaryRoot, "assets");
    await fs.mkdir(assetRoot);
    context.after(() =>
        fs.rm(temporaryRoot, { recursive: true, force: true }),
    );
    return assetRoot;
}

function CreateResponse() {
    return {
        statusCode: 0,
        headers: new Map(),
        body: "",
        writeHead(statusCode, headers = {}) {
            this.statusCode = statusCode;
            for (const [name, value] of Object.entries(headers)) {
                this.headers.set(name.toLowerCase(), value);
            }
        },
        setHeader(name, value) {
            this.headers.set(name.toLowerCase(), value);
        },
        end(body) {
            this.body = body;
        },
    };
}

async function RequestAssetDirectory(
    assetRoot,
    { requestedPath = "", method = "GET" } = {},
) {
    const response = CreateResponse();
    const requestUrl = new URL("http://localhost/api/assets");
    requestUrl.searchParams.set("path", requestedPath);
    await HandleAssetDirectoryRequest(
        { method },
        response,
        requestUrl,
        assetRoot,
    );

    return {
        statusCode: response.statusCode,
        headers: response.headers,
        body: JSON.parse(response.body),
    };
}

test("lists V1 asset metadata and classifies files", async (context) => {
    const assetRoot = await CreateAssetRoot(context);
    await fs.mkdir(path.join(assetRoot, "meshes"));
    await fs.writeFile(path.join(assetRoot, "config.json"), "{}");
    await fs.writeFile(path.join(assetRoot, "main.scene.json"), "{}");
    await fs.writeFile(path.join(assetRoot, "portrait.PNG"), "image");
    await fs.writeFile(path.join(assetRoot, "meshes", "creature.glb"), "mesh");

    const rootResponse = await RequestAssetDirectory(assetRoot);

    assert.equal(rootResponse.statusCode, 200);
    assert.equal(rootResponse.body.format, "astral-asset-directory");
    assert.equal(rootResponse.body.version, 1);
    assert.deepEqual(
        rootResponse.body.entries.map((entry) => [
            entry.name,
            entry.kind,
            entry.type,
            entry.sizeBytes,
        ]),
        [
            ["meshes", "directory", "folder", null],
            ["config.json", "file", "data", 2],
            ["main.scene.json", "file", "scene", 2],
            ["portrait.PNG", "file", "image", 5],
        ],
    );

    const nestedResponse = await RequestAssetDirectory(assetRoot, {
        requestedPath: "meshes",
    });
    assert.equal(nestedResponse.body.path, "meshes");
    assert.deepEqual(
        nestedResponse.body.entries.map((entry) => [
            entry.name,
            entry.type,
            entry.sizeBytes,
        ]),
        [["creature.glb", "model", 4]],
    );
});

test("refresh reflects files added and removed from a folder", async (context) => {
    const assetRoot = await CreateAssetRoot(context);
    const oldFilePath = path.join(assetRoot, "old.txt");
    await fs.writeFile(oldFilePath, "old");

    const firstResponse = await RequestAssetDirectory(assetRoot);
    assert.deepEqual(
        firstResponse.body.entries.map((entry) => entry.name),
        ["old.txt"],
    );

    await fs.rm(oldFilePath);
    await fs.writeFile(path.join(assetRoot, "new.txt"), "new");

    const refreshedResponse = await RequestAssetDirectory(assetRoot);
    assert.deepEqual(
        refreshedResponse.body.entries.map((entry) => entry.name),
        ["new.txt"],
    );
});

test("rejects paths outside the asset root and reports missing folders", async (context) => {
    const assetRoot = await CreateAssetRoot(context);

    const traversalResponse = await RequestAssetDirectory(assetRoot, {
        requestedPath: "../outside",
    });
    assert.equal(traversalResponse.statusCode, 403);
    assert.match(traversalResponse.body.error.message, /outside assets/);

    const missingResponse = await RequestAssetDirectory(assetRoot, {
        requestedPath: "missing",
    });
    assert.equal(missingResponse.statusCode, 404);
    assert.match(missingResponse.body.error.message, /not found under assets/);
});

test("reports inaccessible asset folders clearly", async (context) => {
    const assetRoot = await CreateAssetRoot(context);
    const originalReadDirectory = fs.readdir;
    fs.readdir = async () => {
        throw Object.assign(new Error("Denied"), { code: "EACCES" });
    };

    try {
        const response = await RequestAssetDirectory(assetRoot);
        assert.equal(response.statusCode, 403);
        assert.equal(response.body.error.message, "Folder is not accessible.");
    } finally {
        fs.readdir = originalReadDirectory;
    }
});

test("does not list or follow symlinks outside the asset root", async (context) => {
    const assetRoot = await CreateAssetRoot(context);
    const outsidePath = path.join(path.dirname(assetRoot), "outside");
    await fs.mkdir(outsidePath);

    try {
        await fs.symlink(
            outsidePath,
            path.join(assetRoot, "outside-link"),
            process.platform === "win32" ? "junction" : "dir",
        );
    } catch (error) {
        if (["EACCES", "EPERM", "ENOTSUP", "EOPNOTSUPP"].includes(error.code)) {
            context.skip("The current platform does not allow symlink creation.");
            return;
        }
        throw error;
    }

    const rootResponse = await RequestAssetDirectory(assetRoot);
    assert.deepEqual(rootResponse.body.entries, []);

    const linkResponse = await RequestAssetDirectory(assetRoot, {
        requestedPath: "outside-link",
    });
    assert.equal(linkResponse.statusCode, 403);
});

test("allows only GET requests", async (context) => {
    const assetRoot = await CreateAssetRoot(context);
    const response = await RequestAssetDirectory(assetRoot, { method: "POST" });

    assert.equal(response.statusCode, 405);
    assert.equal(response.headers.get("allow"), "GET");
});
