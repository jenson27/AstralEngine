function RequireObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`${label} must be an object.`);
    }
}

function RequireNonEmptyString(value, label) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new TypeError(`${label} must be a non-empty string.`);
    }
}

function ReadPair(value, label, allowZero = true) {
    if (
        !Array.isArray(value) ||
        value.length !== 2 ||
        !value.every(Number.isFinite) ||
        value.some((entry) => allowZero ? entry < 0 : entry <= 0)
    ) {
        throw new TypeError(`${label} must contain two valid numbers.`);
    }
    return [...value];
}

function CloneJson(value) {
    const clone = JSON.parse(JSON.stringify(value));
    const freeze = (item) => {
        if (!item || typeof item !== "object" || Object.isFrozen(item)) {
            return;
        }
        Object.values(item).forEach(freeze);
        Object.freeze(item);
    };
    freeze(clone);
    return clone;
}

function GetSerializedDefinitionBytes(definition) {
    const serializedDefinition = JSON.stringify(definition);
    if (typeof serializedDefinition !== "string") {
        throw new TypeError("Sprite animation definition must be JSON serializable.");
    }
    return new TextEncoder().encode(serializedDefinition).byteLength;
}

function ValidateSteps(clipName, clip, grid) {
    const maximumFrame = grid.columns * grid.rows;
    let steps;

    if (Array.isArray(clip.frames)) {
        steps = clip.frames.map((frame, index) => {
            RequireObject(frame, `Clip "${clipName}" frame ${index}`);
            if (
                !Number.isSafeInteger(frame.frame) ||
                frame.frame < 0 ||
                frame.frame >= maximumFrame
            ) {
                throw new RangeError(
                    `Clip "${clipName}" frame ${index} is outside the sprite sheet.`,
                );
            }
            if (!Number.isFinite(frame.durationMs) || frame.durationMs <= 0) {
                throw new RangeError(
                    `Clip "${clipName}" frame ${index} needs a positive durationMs.`,
                );
            }
            return {
                frame: frame.frame,
                durationMs: frame.durationMs,
                triggers: ValidateTriggers(
                    frame.triggers ?? [],
                    clipName,
                    index,
                ),
            };
        });
    } else {
        if (
            !Number.isSafeInteger(clip.startFrame) ||
            !Number.isSafeInteger(clip.endFrameExclusive) ||
            clip.startFrame < 0 ||
            clip.endFrameExclusive <= clip.startFrame ||
            clip.endFrameExclusive > maximumFrame ||
            !Number.isFinite(clip.frameRate) ||
            clip.frameRate <= 0
        ) {
            throw new RangeError(
                `Clip "${clipName}" needs a valid frame range and positive frameRate.`,
            );
        }
        const durationMs = 1000 / clip.frameRate;
        steps = Array.from(
            { length: clip.endFrameExclusive - clip.startFrame },
            (_, index) => ({
                frame: clip.startFrame + index,
                durationMs,
                triggers: [],
            }),
        );
    }

    if (steps.length === 0) {
        throw new TypeError(`Clip "${clipName}" must contain at least one frame.`);
    }

    if (clip.triggers !== undefined) {
        if (!Array.isArray(clip.triggers)) {
            throw new TypeError(`Clip "${clipName}" triggers must be an array.`);
        }
        for (const trigger of clip.triggers) {
            if (!Number.isSafeInteger(trigger?.step) || trigger.step < 0 || trigger.step >= steps.length) {
                throw new RangeError(`Clip "${clipName}" trigger step is outside the clip sequence.`);
            }
            const [validatedTrigger] = ValidateTriggers(
                [{ action: trigger.action, payload: trigger.payload }],
                clipName,
                trigger.step,
            );
            steps[trigger.step].triggers.push(validatedTrigger);
        }
    }

    return steps;
}

function ValidateTriggers(triggers, clipName, frameIndex) {
    if (!Array.isArray(triggers)) {
        throw new TypeError(
            `Clip "${clipName}" frame ${frameIndex} triggers must be an array.`,
        );
    }
    return triggers.map((trigger) => {
        RequireObject(trigger, `Clip "${clipName}" trigger`);
        RequireNonEmptyString(trigger.action, "Sprite action name");
        const payload = trigger.payload ?? {};
        RequireObject(payload, "Sprite action payload");
        return { action: trigger.action, payload: CloneJson(payload) };
    });
}

export class SpriteAnimationAsset {
    constructor(definition, texture) {
        RequireObject(definition, "Sprite animation definition");
        if (definition.version !== 1) {
            throw new Error("Sprite animation asset version must be 1.");
        }
        RequireNonEmptyString(definition.textureAssetId, "Texture asset ID");
        if (
            !texture?.bitmap ||
            !Number.isSafeInteger(texture.width) ||
            texture.width <= 0 ||
            !Number.isSafeInteger(texture.height) ||
            texture.height <= 0
        ) {
            throw new TypeError("Sprite animation texture is invalid.");
        }
        RequireObject(definition.grid, "Sprite sheet grid");
        const frameWidth = definition.grid.frameWidth;
        const frameHeight = definition.grid.frameHeight;
        const columns = definition.grid.columns;
        const margin = ReadPair(definition.grid.margin ?? [0, 0], "Grid margin");
        const spacing = ReadPair(definition.grid.spacing ?? [0, 0], "Grid spacing");
        if (![...margin, ...spacing].every(Number.isSafeInteger)) {
            throw new TypeError("Sprite sheet margin and spacing must use whole pixels.");
        }
        if (
            !Number.isSafeInteger(frameWidth) || frameWidth <= 0 ||
            !Number.isSafeInteger(frameHeight) || frameHeight <= 0 ||
            !Number.isSafeInteger(columns) || columns <= 0
        ) {
            throw new TypeError("Sprite sheet frame size and columns must be positive integers.");
        }
        const rows = Math.floor(
            (texture.height - margin[1] * 2 + spacing[1]) /
                (frameHeight + spacing[1]),
        );
        if (
            rows <= 0 ||
            margin[0] + columns * frameWidth + (columns - 1) * spacing[0] > texture.width ||
            margin[1] + rows * frameHeight + (rows - 1) * spacing[1] > texture.height
        ) {
            throw new RangeError("Sprite sheet grid does not fit its texture.");
        }
        if (!Number.isFinite(definition.pixelsPerUnit) || definition.pixelsPerUnit <= 0) {
            throw new RangeError("Sprite pixelsPerUnit must be positive.");
        }
        const pivot = ReadPair(definition.pivot, "Sprite pivot");
        if (pivot.some((value) => value > 1)) {
            throw new RangeError("Sprite pivot values must be between 0 and 1.");
        }
        RequireNonEmptyString(definition.defaultClip, "Default clip name");
        RequireObject(definition.eventToClip, "Sprite event-to-clip map");
        RequireObject(definition.clips, "Sprite clips");
        if (!definition.clips[definition.defaultClip]) {
            throw new RangeError("Sprite animation default clip does not exist.");
        }

        const grid = { frameWidth, frameHeight, columns, rows, margin, spacing };
        const clips = new Map();
        for (const [clipName, clip] of Object.entries(definition.clips)) {
            RequireNonEmptyString(clipName, "Sprite clip name");
            RequireObject(clip, `Sprite clip "${clipName}"`);
            const priority = clip.priority ?? 0;
            if (!Number.isFinite(priority)) {
                throw new TypeError(`Clip "${clipName}" priority must be finite.`);
            }
            const loop = clip.loop ?? false;
            if (typeof loop !== "boolean") {
                throw new TypeError(`Clip "${clipName}" loop must be boolean.`);
            }
            const replayOnEvent = clip.replayOnEvent ?? false;
            const returnToDefault = clip.returnToDefault ?? false;
            if (typeof replayOnEvent !== "boolean" || typeof returnToDefault !== "boolean") {
                throw new TypeError(`Clip "${clipName}" replayOnEvent and returnToDefault must be boolean.`);
            }
            clips.set(clipName, Object.freeze({
                name: clipName,
                priority,
                loop,
                replayOnEvent,
                returnToDefault,
                steps: Object.freeze(ValidateSteps(clipName, clip, grid)
                    .map((step) => Object.freeze({
                        ...step,
                        triggers: Object.freeze(step.triggers),
                    }))),
            }));
        }

        const eventToClip = new Map();
        for (const [eventName, clipName] of Object.entries(definition.eventToClip)) {
            RequireNonEmptyString(eventName, "Sprite event name");
            RequireNonEmptyString(clipName, `Clip for event "${eventName}"`);
            if (!clips.has(clipName)) {
                throw new RangeError(`Sprite event "${eventName}" refers to an unknown clip.`);
            }
            eventToClip.set(eventName, clipName);
        }

        this.Version = 1;
        this.TextureAssetId = definition.textureAssetId;
        this.Texture = texture;
        this.Grid = Object.freeze({ ...grid, margin: Object.freeze(margin), spacing: Object.freeze(spacing) });
        this.PixelsPerUnit = definition.pixelsPerUnit;
        this.Pivot = Object.freeze(pivot);
        this.DefaultClip = definition.defaultClip;
        this.MemoryUsageBytes = GetSerializedDefinitionBytes(definition);
        this.MemoryUsageEstimated = true;
        this._clips = clips;
        this._eventToClip = eventToClip;
    }

    GetClip(clipName) {
        return this._clips.get(clipName);
    }

    GetClipNames() {
        return Object.freeze([...this._clips.keys()]);
    }

    GetActionTriggers() {
        const actionTriggers = [];
        for (const clip of this._clips.values()) {
            for (const step of clip.steps) {
                for (const trigger of step.triggers) {
                    actionTriggers.push(Object.freeze({
                        action: trigger.action,
                        clipName: clip.name,
                        frameIndex: step.frame,
                    }));
                }
            }
        }
        return Object.freeze(actionTriggers);
    }

    GetClipForEvent(eventName) {
        return this._eventToClip.get(eventName);
    }

    GetFrameUv(frameIndex) {
        if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex >= this.Grid.columns * this.Grid.rows) {
            throw new RangeError("Sprite frame index is outside the sprite sheet.");
        }
        const { frameWidth, frameHeight, columns, margin, spacing } = this.Grid;
        const column = frameIndex % columns;
        const row = Math.floor(frameIndex / columns);
        const x = margin[0] + column * (frameWidth + spacing[0]);
        const y = margin[1] + row * (frameHeight + spacing[1]);
        return [
            x / this.Texture.width,
            y / this.Texture.height,
            frameWidth / this.Texture.width,
            frameHeight / this.Texture.height,
        ];
    }
}
