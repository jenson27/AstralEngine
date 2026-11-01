export class Material {
    constructor(baseColorTexture) {
        if (!baseColorTexture?.bitmap) {
            throw new TypeError(
                "Material requires a decoded base color texture.",
            );
        }

        this._baseColorTexture = baseColorTexture;
    }

    get BaseColorTexture() {
        return this._baseColorTexture;
    }
}
