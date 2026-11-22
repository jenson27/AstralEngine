const ASSET_FILE_TYPE_LABELS = Object.freeze({
    folder: "Folder",
    image: "Image",
    audio: "Audio",
    glb: "GLB model",
    model: "3D model",
    scene: "Scene",
    data: "Data",
    shader: "Shader",
    other: "Other",
});

export const ASSET_FILE_TYPE_OPTIONS = Object.freeze([
    Object.freeze({ value: "all", label: "All types" }),
    Object.freeze({ value: "image", label: "Images" }),
    Object.freeze({ value: "audio", label: "Audio" }),
    Object.freeze({ value: "glb", label: "GLB models" }),
    Object.freeze({ value: "model", label: "3D models" }),
    Object.freeze({ value: "scene", label: "Scenes" }),
    Object.freeze({ value: "data", label: "Data" }),
    Object.freeze({ value: "shader", label: "Shaders" }),
    Object.freeze({ value: "other", label: "Other files" }),
]);

export function GetAssetFileTypeLabel(type) {
    return Object.hasOwn(ASSET_FILE_TYPE_LABELS, type)
        ? ASSET_FILE_TYPE_LABELS[type]
        : ASSET_FILE_TYPE_LABELS.other;
}

export function FilterAssetEntries(
    entries,
    { searchText = "", typeFilter = "all" } = {},
) {
    const normalizedSearch = searchText.trim().toLocaleLowerCase();

    return entries.filter((entry) => {
        if (
            normalizedSearch &&
            !entry.name.toLocaleLowerCase().includes(normalizedSearch)
        ) {
            return false;
        }

        return (
            entry.kind === "directory" ||
            typeFilter === "all" ||
            entry.type === typeFilter
        );
    });
}

export function FormatAssetFileSize(sizeBytes) {
    if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
        return "Unknown size";
    }
    if (sizeBytes < 1024) {
        return `${sizeBytes} bytes`;
    }

    const units = ["KiB", "MiB", "GiB", "TiB"];
    let size = sizeBytes;
    let unitIndex = -1;

    do {
        size /= 1024;
        unitIndex += 1;
    } while (size >= 1024 && unitIndex < units.length - 1);

    return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]} (${sizeBytes.toLocaleString()} bytes)`;
}

export function GetAssetFileUrl(relativePath) {
    const encodedPath = relativePath
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
    return `/assets/${encodedPath}`;
}

