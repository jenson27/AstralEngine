const fs = require("node:fs/promises");
const path = require("node:path");

const RESPONSE_FORMAT = "astral-asset-directory";
const RESPONSE_VERSION = 1;
const FILE_TYPES_BY_EXTENSION = new Map([
    [".avif", "image"],
    [".bmp", "image"],
    [".gif", "image"],
    [".jpeg", "image"],
    [".jpg", "image"],
    [".png", "image"],
    [".webp", "image"],
    [".aac", "audio"],
    [".flac", "audio"],
    [".m4a", "audio"],
    [".mp3", "audio"],
    [".ogg", "audio"],
    [".wav", "audio"],
    [".fbx", "model"],
    [".glb", "glb"],
    [".gltf", "model"],
    [".obj", "model"],
    [".frag", "shader"],
    [".glsl", "shader"],
    [".vert", "shader"],
    [".wgsl", "shader"],
    [".json", "data"],
]);

function CreateApiError(statusCode, message) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function NormalizeRelativePath(relativePath) {
    if (typeof relativePath !== "string") {
        throw CreateApiError(400, "Folder path must be a relative path under assets/.");
    }

    if (
        relativePath.includes("\0") ||
        relativePath.includes("\\") ||
        relativePath.startsWith("/") ||
        path.win32.isAbsolute(relativePath)
    ) {
        throw CreateApiError(400, "Folder path must be a relative path under assets/.");
    }

    const segments = relativePath.split("/");
    if (segments.some((segment) => segment === "..")) {
        throw CreateApiError(403, "Requested folder is outside assets/.");
    }

    return segments
        .filter((segment) => segment !== "" && segment !== ".")
        .join("/");
}

function IsPathWithinRoot(rootPath, candidatePath) {
    const relativePath = path.relative(rootPath, candidatePath);
    return (
        relativePath === "" ||
        (relativePath !== ".." &&
            !relativePath.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relativePath))
    );
}

function GetAssetFileType(fileName) {
    const lowerFileName = fileName.toLowerCase();
    if (
        lowerFileName.endsWith(".scene.json") ||
        lowerFileName.endsWith(".editor-scene.json")
    ) {
        return "scene";
    }

    return FILE_TYPES_BY_EXTENSION.get(path.extname(lowerFileName)) ?? "other";
}

function GetFileSystemError(error) {
    if (error.statusCode) {
        return error;
    }
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
        return CreateApiError(404, "Folder was not found under assets/.");
    }
    if (error.code === "EACCES" || error.code === "EPERM") {
        return CreateApiError(403, "Folder is not accessible.");
    }
    return CreateApiError(500, "Could not read the asset folder.");
}

async function ListAssetDirectory(assetRoot, requestedPath) {
    const relativePath = NormalizeRelativePath(requestedPath);
    const realAssetRoot = await fs.realpath(assetRoot);
    const candidatePath = path.resolve(realAssetRoot, relativePath || ".");

    if (!IsPathWithinRoot(realAssetRoot, candidatePath)) {
        throw CreateApiError(403, "Requested folder is outside assets/.");
    }

    const realDirectoryPath = await fs.realpath(candidatePath);
    if (!IsPathWithinRoot(realAssetRoot, realDirectoryPath)) {
        throw CreateApiError(403, "Requested folder is outside assets/.");
    }

    const directoryEntries = await fs.readdir(realDirectoryPath, {
        withFileTypes: true,
    });
    const entries = [];

    for (const directoryEntry of directoryEntries) {
        if (directoryEntry.isSymbolicLink()) {
            continue;
        }

        const absoluteEntryPath = path.join(
            realDirectoryPath,
            directoryEntry.name,
        );
        let entryStats;

        try {
            entryStats = await fs.lstat(absoluteEntryPath);
        } catch (error) {
            if (error.code === "ENOENT") {
                continue;
            }
            throw error;
        }

        if (entryStats.isSymbolicLink()) {
            continue;
        }

        const kind = entryStats.isDirectory()
            ? "directory"
            : entryStats.isFile()
              ? "file"
              : null;
        if (!kind) {
            continue;
        }

        const entryRelativePath = relativePath
            ? `${relativePath}/${directoryEntry.name}`
            : directoryEntry.name;
        entries.push({
            name: directoryEntry.name,
            relativePath: entryRelativePath,
            kind,
            type: kind === "directory" ? "folder" : GetAssetFileType(directoryEntry.name),
            sizeBytes: kind === "file" ? entryStats.size : null,
        });
    }

    entries.sort((left, right) => {
        if (left.kind !== right.kind) {
            return left.kind === "directory" ? -1 : 1;
        }
        return left.name.localeCompare(right.name, undefined, {
            numeric: true,
            sensitivity: "base",
        });
    });

    return {
        format: RESPONSE_FORMAT,
        version: RESPONSE_VERSION,
        path: relativePath,
        entries,
    };
}

function SendJson(response, statusCode, body) {
    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(body));
}

async function HandleAssetDirectoryRequest(request, response, requestUrl, assetRoot) {
    if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        SendJson(response, 405, {
            format: RESPONSE_FORMAT,
            version: RESPONSE_VERSION,
            error: { message: "Only GET is supported for asset browsing." },
        });
        return;
    }

    try {
        const data = await ListAssetDirectory(
            assetRoot,
            requestUrl.searchParams.get("path") ?? "",
        );
        SendJson(response, 200, data);
    } catch (error) {
        const apiError = GetFileSystemError(error);
        SendJson(response, apiError.statusCode, {
            format: RESPONSE_FORMAT,
            version: RESPONSE_VERSION,
            error: { message: apiError.message },
        });
    }
}

module.exports = { HandleAssetDirectoryRequest };
