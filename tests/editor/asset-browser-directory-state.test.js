import assert from "node:assert/strict";
import test from "node:test";
import { AssetBrowserDirectoryState } from "../../src/editor/panels/asset-browser/asset-browser-directory-state.js";

function CreateDirectoryResponse(path, entries) {
    return {
        ok: true,
        json: async () => ({
            format: "astral-asset-directory",
            version: 1,
            path,
            entries,
        }),
    };
}

function CreateErrorResponse(status, message) {
    return {
        ok: false,
        status,
        json: async () => ({ error: { message } }),
    };
}

function GetRequestedPath(url) {
    return new URL(url, "http://localhost").searchParams.get("path") ?? "";
}

test("retrying a parent reloads the selected nested folder", async () => {
    let parentRequestCount = 0;
    let childRequestCount = 0;
    let grandchildRequestCount = 0;
    const state = new AssetBrowserDirectoryState({
        fetcher: async (url) => {
            const path = GetRequestedPath(url);
            if (path === "") {
                return CreateDirectoryResponse("", [
                    {
                        name: "parent",
                        relativePath: "parent",
                        kind: "directory",
                        type: "folder",
                        sizeBytes: null,
                    },
                ]);
            }
            if (path === "parent") {
                parentRequestCount += 1;
                if (parentRequestCount === 2) {
                    return CreateErrorResponse(500, "Temporary read failure.");
                }
                return CreateDirectoryResponse("parent", [
                    {
                        name: "child",
                        relativePath: "parent/child",
                        kind: "directory",
                        type: "folder",
                        sizeBytes: null,
                    },
                ]);
            }
            if (path === "parent/child") {
                childRequestCount += 1;
                return CreateDirectoryResponse(path, [
                    {
                        name: "grandchild",
                        relativePath: "parent/child/grandchild",
                        kind: "directory",
                        type: "folder",
                        sizeBytes: null,
                    },
                ]);
            }
            if (path === "parent/child/grandchild") {
                grandchildRequestCount += 1;
                return CreateDirectoryResponse(path, [
                    {
                        name: "nested.txt",
                        relativePath: "parent/child/grandchild/nested.txt",
                        kind: "file",
                        type: "data",
                        sizeBytes: 12,
                    },
                ]);
            }
            throw new Error("Unexpected asset path: " + path);
        },
    });

    await state.Refresh();
    await state.SelectDirectory("parent");
    await state.SelectDirectory("parent/child");
    await state.SelectDirectory("parent/child/grandchild");
    state.SelectFile("parent/child/grandchild/nested.txt");

    await state.Refresh();
    assert.equal(state.GetSnapshot().loadFailed, true);
    assert.deepEqual(state.GetSnapshot().entries, []);

    await state.RetryDirectory("parent");

    const snapshot = state.GetSnapshot();
    assert.equal(parentRequestCount, 3);
    assert.equal(childRequestCount, 2);
    assert.equal(grandchildRequestCount, 2);
    assert.equal(snapshot.currentPath, "parent/child/grandchild");
    assert.equal(snapshot.loadFailed, false);
    assert.equal(
        snapshot.entries[0].relativePath,
        "parent/child/grandchild/nested.txt",
    );
    assert.equal(snapshot.selectedRelativePath, null);
    state.Dispose();
});

test("refresh loads expanded sibling folders in parallel", async () => {
    let activeFolderRequests = 0;
    let maxActiveFolderRequests = 0;
    const state = new AssetBrowserDirectoryState({
        fetcher: async (url) => {
            const path = GetRequestedPath(url);
            if (!path) {
                return CreateDirectoryResponse("", [
                    {
                        name: "first",
                        relativePath: "first",
                        kind: "directory",
                        type: "folder",
                        sizeBytes: null,
                    },
                    {
                        name: "second",
                        relativePath: "second",
                        kind: "directory",
                        type: "folder",
                        sizeBytes: null,
                    },
                ]);
            }

            activeFolderRequests += 1;
            maxActiveFolderRequests = Math.max(
                maxActiveFolderRequests,
                activeFolderRequests,
            );
            await new Promise((resolve) => setTimeout(resolve, 10));
            activeFolderRequests -= 1;
            return CreateDirectoryResponse(path, []);
        },
    });

    await state.Refresh();
    await Promise.all([
        state.ToggleDirectory("first"),
        state.ToggleDirectory("second"),
    ]);
    maxActiveFolderRequests = 0;

    await state.Refresh();

    assert.equal(maxActiveFolderRequests, 2);
    state.Dispose();
});
