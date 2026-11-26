function ReadColor(value) {
    if (
        !Array.isArray(value) ||
        value.length !== 4 ||
        !value.every(Number.isFinite) ||
        value.some((entry) => entry < 0 || entry > 1)
    ) {
        throw new TypeError("Sprite tint must contain four values between 0 and 1.");
    }
    return [...value];
}

const BILLBOARD_MODES = new Set(["spherical", "cylindrical"]);

export class SpriteRenderer {
    constructor(settings = {}) {
        this.SetSettings(settings);
    }

    SetSettings({
        billboardMode = this.billboardMode ?? "spherical",
        tint = this.tint ?? [1, 1, 1, 1],
        renderOrder = this.renderOrder ?? 0,
    } = {}) {
        if (!BILLBOARD_MODES.has(billboardMode)) {
            throw new TypeError("Sprite billboardMode must be spherical or cylindrical.");
        }
        if (!Number.isFinite(renderOrder)) {
            throw new TypeError("Sprite renderOrder must be finite.");
        }
        const nextTint = ReadColor(tint);

        this.billboardMode = billboardMode;
        this.tint = nextTint;
        this.renderOrder = renderOrder;
    }
}
