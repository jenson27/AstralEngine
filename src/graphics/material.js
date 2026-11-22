export class Material {
    constructor(
        baseColorTexture = null,
        {
            baseColorFactor = [1, 1, 1, 1],
            baseColorMinFilter = "linear-mipmap-linear",
            name = "",
        } = {},
    ) {
        if (baseColorTexture !== null && !baseColorTexture?.bitmap) {
            throw new TypeError(
                "Material base color texture must contain a decoded bitmap.",
            );
        }
        if (
            !Array.isArray(baseColorFactor) ||
            baseColorFactor.length !== 4 ||
            !baseColorFactor.every(
                (value) => Number.isFinite(value) && value >= 0 && value <= 1,
            )
        ) {
            throw new TypeError(
                "Material base color factor must contain four values from 0 to 1.",
            );
        }
        if (typeof name !== "string") {
            throw new TypeError("Material name must be a string.");
        }
        if (![
            "linear",
            "linear-mipmap-linear",
        ].includes(baseColorMinFilter)) {
            throw new TypeError("Material base color minification mode is invalid.");
        }

        this._baseColorTexture = baseColorTexture;
        this._baseColorFactor = Object.freeze([...baseColorFactor]);
        this._baseColorMinFilter = baseColorMinFilter;
        this._name = name;
    }

    get BaseColorTexture() {
        return this._baseColorTexture;
    }

    get BaseColorFactor() {
        return this._baseColorFactor;
    }

    get BaseColorMinFilter() {
        return this._baseColorMinFilter;
    }

    get Name() {
        return this._name;
    }
}
