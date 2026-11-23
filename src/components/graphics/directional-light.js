function ReadVector3(value, label, { nonNegative = false } = {}) {
    if (
        !Array.isArray(value) ||
        value.length !== 3 ||
        !value.every((component) => Number.isFinite(component) &&
            (!nonNegative || component >= 0))
    ) {
        throw new TypeError(`${label} must contain three valid finite values.`);
    }
    return [...value];
}

function ValidateSettings(settings) {
    const direction = ReadVector3(settings.direction, "Directional light direction");
    const color = ReadVector3(settings.color, "Directional light color", { nonNegative: true });
    const directionLength = Math.hypot(...direction);
    if (directionLength === 0) {
        throw new RangeError("Directional light direction cannot be zero.");
    }
    if (!Number.isFinite(settings.intensity) || settings.intensity < 0) {
        throw new RangeError("Directional light intensity must be non-negative.");
    }
    return {
        direction: direction.map((component) => component / directionLength),
        color,
        intensity: settings.intensity,
    };
}

export class DirectionalLight {
    constructor(settings = {}) {
        this.SetSettings({
            direction: settings.direction ?? [0.4, 0.8, 0.45],
            color: settings.color ?? [1, 1, 1],
            intensity: settings.intensity ?? 3,
        });
    }

    SetSettings(settings) {
        const values = ValidateSettings(settings);
        this._direction = values.direction;
        this._color = values.color;
        this._intensity = values.intensity;
    }

    get Direction() { return [...this._direction]; }
    get Color() { return [...this._color]; }
    get Intensity() { return this._intensity; }
}
