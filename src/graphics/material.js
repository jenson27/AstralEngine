const DEFAULT_SAMPLER = Object.freeze({
    addressModeU: "repeat",
    addressModeV: "repeat",
    magFilter: "linear",
    minFilter: "linear",
    mipmapFilter: "linear",
    mipmaps: true,
});

function ValidateTexture(texture, label) {
    if (texture !== null && !texture?.bitmap) {
        throw new TypeError(`${label} must contain a decoded bitmap.`);
    }
}

function ValidateFactor(value, length, label, maximum = 1) {
    if (
        !Array.isArray(value) ||
        value.length !== length ||
        !value.every((component) =>
            Number.isFinite(component) && component >= 0 && component <= maximum,
        )
    ) {
        throw new TypeError(`${label} must contain ${length} values from 0 to ${maximum}.`);
    }
}

function NormalizeSampler(sampler, label) {
    if (!sampler || typeof sampler !== "object" || Array.isArray(sampler)) {
        throw new TypeError(`${label} must be an object.`);
    }
    const normalized = {
        addressModeU: sampler.addressModeU ?? DEFAULT_SAMPLER.addressModeU,
        addressModeV: sampler.addressModeV ?? DEFAULT_SAMPLER.addressModeV,
        magFilter: sampler.magFilter ?? DEFAULT_SAMPLER.magFilter,
        minFilter: sampler.minFilter ?? DEFAULT_SAMPLER.minFilter,
        mipmapFilter: sampler.mipmapFilter ?? DEFAULT_SAMPLER.mipmapFilter,
        mipmaps: sampler.mipmaps ?? DEFAULT_SAMPLER.mipmaps,
    };
    if (![
        "repeat",
        "clamp-to-edge",
        "mirror-repeat",
    ].includes(normalized.addressModeU) || ![
        "repeat",
        "clamp-to-edge",
        "mirror-repeat",
    ].includes(normalized.addressModeV)) {
        throw new TypeError(`${label} has an unsupported address mode.`);
    }
    if (!["nearest", "linear"].includes(normalized.magFilter) ||
        !["nearest", "linear"].includes(normalized.minFilter) ||
        !["nearest", "linear"].includes(normalized.mipmapFilter) ||
        typeof normalized.mipmaps !== "boolean") {
        throw new TypeError(`${label} has an unsupported filter setting.`);
    }
    return Object.freeze(normalized);
}

export class Material {
    constructor(
        baseColorTexture = null,
        {
            baseColorFactor = [1, 1, 1, 1],
            baseColorMinFilter,
            baseColorSampler = DEFAULT_SAMPLER,
            baseColorTexCoord = 0,
            metallicFactor = 1,
            roughnessFactor = 1,
            metallicRoughnessTexture = null,
            metallicRoughnessSampler = DEFAULT_SAMPLER,
            metallicRoughnessTexCoord = 0,
            alphaMode = "OPAQUE",
            alphaCutoff = 0.5,
            unlit = false,
            name = "",
        } = {},
    ) {
        ValidateTexture(baseColorTexture, "Material base color texture");
        ValidateTexture(metallicRoughnessTexture, "Material metallic-roughness texture");
        ValidateFactor(baseColorFactor, 4, "Material base color factor");
        if (!Number.isFinite(metallicFactor) || metallicFactor < 0 || metallicFactor > 1) {
            throw new TypeError("Material metallic factor must be from 0 to 1.");
        }
        if (!Number.isFinite(roughnessFactor) || roughnessFactor < 0 || roughnessFactor > 1) {
            throw new TypeError("Material roughness factor must be from 0 to 1.");
        }
        if (!Number.isFinite(alphaCutoff) || alphaCutoff < 0 || alphaCutoff > 1) {
            throw new TypeError("Material alpha cutoff must be from 0 to 1.");
        }
        if (!Number.isSafeInteger(baseColorTexCoord) || baseColorTexCoord < 0 || baseColorTexCoord > 1 ||
            !Number.isSafeInteger(metallicRoughnessTexCoord) || metallicRoughnessTexCoord < 0 || metallicRoughnessTexCoord > 1) {
            throw new RangeError("Material texture coordinate sets must be 0 or 1.");
        }
        if (!["OPAQUE", "MASK"].includes(alphaMode)) {
            throw new TypeError("Material alpha mode must be OPAQUE or MASK.");
        }
        if (typeof unlit !== "boolean" || typeof name !== "string") {
            throw new TypeError("Material unlit flag or name is invalid.");
        }
        if (baseColorMinFilter !== undefined &&
            !["linear", "linear-mipmap-linear"].includes(baseColorMinFilter)) {
            throw new TypeError("Material base color minification mode is invalid.");
        }

        const resolvedBaseSampler = {
            ...baseColorSampler,
            ...(baseColorMinFilter === undefined
                ? {}
                : {
                    minFilter: "linear",
                    mipmapFilter: baseColorMinFilter === "linear" ? "nearest" : "linear",
                    mipmaps: baseColorMinFilter !== "linear",
                }),
        };
        this._baseColorTexture = baseColorTexture;
        this._baseColorFactor = Object.freeze([...baseColorFactor]);
        this._baseColorSampler = NormalizeSampler(resolvedBaseSampler, "Material base color sampler");
        this._baseColorTexCoord = baseColorTexCoord;
        this._metallicFactor = metallicFactor;
        this._roughnessFactor = roughnessFactor;
        this._metallicRoughnessTexture = metallicRoughnessTexture;
        this._metallicRoughnessSampler = NormalizeSampler(
            metallicRoughnessSampler,
            "Material metallic-roughness sampler",
        );
        this._metallicRoughnessTexCoord = metallicRoughnessTexCoord;
        this._alphaMode = alphaMode;
        this._alphaCutoff = alphaCutoff;
        this._unlit = unlit;
        this._name = name;
    }

    get BaseColorTexture() { return this._baseColorTexture; }
    get BaseColorFactor() { return this._baseColorFactor; }
    get BaseColorSampler() { return this._baseColorSampler; }
    get BaseColorTexCoord() { return this._baseColorTexCoord; }
    get BaseColorMinFilter() {
        return this._baseColorSampler.mipmaps ? "linear-mipmap-linear" : "linear";
    }
    get MetallicFactor() { return this._metallicFactor; }
    get RoughnessFactor() { return this._roughnessFactor; }
    get MetallicRoughnessTexture() { return this._metallicRoughnessTexture; }
    get MetallicRoughnessSampler() { return this._metallicRoughnessSampler; }
    get MetallicRoughnessTexCoord() { return this._metallicRoughnessTexCoord; }
    get AlphaMode() { return this._alphaMode; }
    get AlphaCutoff() { return this._alphaCutoff; }
    get IsUnlit() { return this._unlit; }
    get Name() { return this._name; }
}
