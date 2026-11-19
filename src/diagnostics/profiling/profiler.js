export const ProfilerCaptureVersion = 1;

const DEFAULT_FRAME_CAPACITY = 600;
const DEFAULT_SCOPE_CAPACITY = 2048;
const DEFAULT_ASYNC_SPAN_CAPACITY = 256;

function RequirePositiveInteger(value, name) {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new TypeError(name + " must be a positive integer.");
    }
}

function RequireScopeMetadata(name, category) {
    if (typeof name !== "string" || name.trim() === "") {
        throw new TypeError("Profiler scope name must be non-empty.");
    }

    if (typeof category !== "string" || category.trim() === "") {
        throw new TypeError("Profiler scope category must be non-empty.");
    }
}

export class Profiler {
    constructor({
        enabled = true,
        maxFrames = DEFAULT_FRAME_CAPACITY,
        maxScopesPerFrame = DEFAULT_SCOPE_CAPACITY,
        maxAsyncSpans = DEFAULT_ASYNC_SPAN_CAPACITY,
    } = {}) {
        if (typeof enabled !== "boolean") {
            throw new TypeError("Profiler enabled must be a boolean.");
        }

        RequirePositiveInteger(maxFrames, "maxFrames");
        RequirePositiveInteger(maxScopesPerFrame, "maxScopesPerFrame");
        RequirePositiveInteger(maxAsyncSpans, "maxAsyncSpans");

        this._isEnabled = enabled;
        this._maxFrames = maxFrames;
        this._maxScopesPerFrame = maxScopesPerFrame;
        this._maxAsyncSpans = maxAsyncSpans;
        this._frames = new Array(maxFrames);
        this._nextFrameIndex = 0;
        this._frameCount = 0;
        this._currentFrame = null;
        this._scopeStack = [];
        this._asyncScopeIndexes = new Set();
        this._asyncScopeTokensBySpanId = new Map();
        this._activeAsyncSpans = new Map();
        this._completedAsyncSpans = [];
        this._nextAsyncSpanId = 1;
        this._droppedAsyncSpanCount = 0;
        this._lastCompletedFrameNumber = null;
        this._gpuFrameTimeMsByFrameNumber = new Map();
        this._revision = 0;
    }

    get IsEnabled() {
        return this._isEnabled;
    }

    get CurrentFrameNumber() {
        return this._currentFrame?.frameNumber ?? null;
    }

    get Revision() {
        return this._revision;
    }

    get DroppedAsyncSpanCount() {
        return this._droppedAsyncSpanCount;
    }

    SetEnabled(enabled) {
        if (typeof enabled !== "boolean") {
            throw new TypeError("Profiler enabled must be a boolean.");
        }

        if (!enabled) {
            const endFrameNumber =
                this._currentFrame?.frameNumber ??
                this._lastCompletedFrameNumber;
            this._currentFrame = null;
            this._scopeStack.length = 0;
            this._asyncScopeIndexes.clear();
            this._asyncScopeTokensBySpanId.clear();
            this._CloseActiveAsyncSpans(
                performance.now(),
                endFrameNumber,
                "incomplete",
            );
        }

        if (this._isEnabled !== enabled) {
            this._revision += 1;
        }

        this._isEnabled = enabled;
    }

    BeginFrame(frameNumber) {
        if (!this._isEnabled) {
            return false;
        }

        if (!Number.isSafeInteger(frameNumber) || frameNumber < 0) {
            throw new TypeError("Frame number must be a non-negative integer.");
        }

        if (this._currentFrame !== null) {
            throw new Error("A profiler frame is already active.");
        }

        this._currentFrame = {
            version: ProfilerCaptureVersion,
            frameNumber,
            startTime: performance.now(),
            endTime: null,
            durationMs: null,
            metrics: Object.create(null),
            scopes: [],
            droppedScopeCount: 0,
        };

        this._scopeStack.length = 0;
        this._asyncScopeIndexes.clear();
        this._asyncScopeTokensBySpanId.clear();
        return true;
    }

    BeginScope(name, category = "function") {
        if (!this._isEnabled || this._currentFrame === null) {
            return null;
        }

        RequireScopeMetadata(name, category);

        const parentScopeIndex =
            this._scopeStack.length === 0
                ? null
                : this._scopeStack[this._scopeStack.length - 1];
        const token = this._CreateScope(
            this._currentFrame,
            name,
            category,
            parentScopeIndex,
        );

        if (token !== null) {
            this._scopeStack.push(token.scopeIndex);
        }

        return token;
    }

    BeginAsyncScope(name, category = "function") {
        if (!this._isEnabled || this._currentFrame === null) {
            return null;
        }

        RequireScopeMetadata(name, category);

        if (this._activeAsyncSpans.size >= this._maxAsyncSpans) {
            this._droppedAsyncSpanCount += 1;
            this._revision += 1;
            return null;
        }

        const spanId = this._nextAsyncSpanId;
        this._nextAsyncSpanId += 1;
        const scopeToken = this._CreateScope(
            this._currentFrame,
            name,
            category,
            null,
            true,
        );

        if (scopeToken !== null) {
            this._asyncScopeIndexes.add(scopeToken.scopeIndex);
            this._asyncScopeTokensBySpanId.set(spanId, scopeToken);
        }

        this._activeAsyncSpans.set(spanId, {
            spanId,
            name,
            category,
            startFrameNumber: this._currentFrame.frameNumber,
            startTime: performance.now(),
        });
        this._revision += 1;
        return { spanId };
    }

    _CreateScope(frame, name, category, parentScopeIndex, isAsync = false) {
        if (frame.scopes.length >= this._maxScopesPerFrame) {
            frame.droppedScopeCount += 1;
            return null;
        }

        const scopeIndex = frame.scopes.length;
        frame.scopes.push({
            name,
            category,
            isAsync,
            parentScopeIndex,
            startTime: performance.now(),
            endTime: null,
            durationMs: null,
            incomplete: false,
        });

        return { frame, scopeIndex };
    }

    EndAsyncScope(token) {
        if (token === null || token === undefined) {
            return;
        }

        const span = this._activeAsyncSpans.get(token.spanId);

        if (!span) {
            return;
        }

        const endTime = performance.now();
        const scopeToken = this._asyncScopeTokensBySpanId.get(token.spanId);

        if (
            scopeToken &&
            scopeToken.frame === this._currentFrame &&
            this._asyncScopeIndexes.has(scopeToken.scopeIndex)
        ) {
            this._asyncScopeIndexes.delete(scopeToken.scopeIndex);
            this._CloseScope(
                this._currentFrame,
                scopeToken.scopeIndex,
                endTime,
                false,
            );
        }

        this._asyncScopeTokensBySpanId.delete(token.spanId);
        this._CompleteAsyncSpan(
            span,
            endTime,
            this._currentFrame?.frameNumber ?? this._lastCompletedFrameNumber,
            "complete",
        );
    }

    EndScope(token) {
        if (token === null || token === undefined) {
            return;
        }

        const frame = this._currentFrame;

        // Ignore a token if capture was stopped while the scope was active.
        if (frame === null || token.frame !== frame) {
            return;
        }

        const activeScopeIndex =
            this._scopeStack[this._scopeStack.length - 1];

        if (activeScopeIndex !== token.scopeIndex) {
            throw new Error("Profiler scopes must end in reverse start order.");
        }

        this._scopeStack.pop();
        this._CloseScope(frame, token.scopeIndex, performance.now(), false);
    }

    RecordFrameMetric(name, value) {
        if (!this._isEnabled || this._currentFrame === null) {
            return false;
        }

        if (typeof name !== "string" || name.trim() === "") {
            throw new TypeError("Profiler metric name must be non-empty.");
        }

        if (!Number.isFinite(value)) {
            throw new TypeError("Profiler metric value must be finite.");
        }

        this._currentFrame.metrics[name] = value;
        return true;
    }

    RecordGpuFrameTime(frameNumber, durationMs) {
        if (
            !Number.isSafeInteger(frameNumber) ||
            frameNumber < 0 ||
            !Number.isFinite(durationMs) ||
            durationMs < 0
        ) {
            throw new TypeError("GPU frame timing requires a valid frame and duration.");
        }

        if (!this._frames.some((frame) => frame?.frameNumber === frameNumber)) {
            return false;
        }

        this._gpuFrameTimeMsByFrameNumber.set(frameNumber, durationMs);
        this._revision += 1;
        return true;
    }

    GetGpuFrameTime(frameNumber) {
        return this._gpuFrameTimeMsByFrameNumber.get(frameNumber) ?? null;
    }

    EndFrame() {
        if (!this._isEnabled || this._currentFrame === null) {
            return null;
        }

        const frame = this._currentFrame;
        const endTime = performance.now();

        this._CloseOpenScopes(frame, endTime);

        frame.endTime = endTime;
        frame.durationMs = Math.max(0, endTime - frame.startTime);

        for (const scope of frame.scopes) {
            Object.freeze(scope);
        }

        Object.freeze(frame.metrics);
        Object.freeze(frame.scopes);
        Object.freeze(frame);

        const overwrittenFrame = this._frames[this._nextFrameIndex];

        if (overwrittenFrame) {
            this._gpuFrameTimeMsByFrameNumber.delete(
                overwrittenFrame.frameNumber,
            );
        }

        this._frames[this._nextFrameIndex] = frame;
        this._nextFrameIndex =
            (this._nextFrameIndex + 1) % this._maxFrames;
        this._frameCount = Math.min(
            this._frameCount + 1,
            this._maxFrames,
        );

        this._currentFrame = null;
        this._lastCompletedFrameNumber = frame.frameNumber;
        this._revision += 1;
        return frame;
    }

    _CloseOpenScopes(frame, endTime) {
        while (this._scopeStack.length > 0) {
            const scopeIndex = this._scopeStack.pop();
            this._CloseScope(frame, scopeIndex, endTime, true);
        }

        for (const scopeIndex of this._asyncScopeIndexes) {
            this._CloseScope(frame, scopeIndex, endTime, true);
        }

        this._asyncScopeIndexes.clear();
        this._asyncScopeTokensBySpanId.clear();
    }

    GetFrames() {
        const frames = [];
        const oldestFrameIndex =
            (this._nextFrameIndex - this._frameCount + this._maxFrames) %
            this._maxFrames;

        for (let offset = 0; offset < this._frameCount; offset += 1) {
            const frameIndex =
                (oldestFrameIndex + offset) % this._maxFrames;
            frames.push(this._frames[frameIndex]);
        }

        return frames;
    }

    GetAsyncSpans() {
        const now = performance.now();
        const spans = this._completedAsyncSpans.slice();

        for (const span of this._activeAsyncSpans.values()) {
            spans.push(
                Object.freeze({
                    ...span,
                    endFrameNumber: null,
                    endTime: null,
                    durationMs: Math.max(0, now - span.startTime),
                    status: "running",
                }),
            );
        }

        return spans.sort((left, right) => left.startTime - right.startTime);
    }

    _CompleteAsyncSpan(span, endTime, endFrameNumber, status) {
        this._activeAsyncSpans.delete(span.spanId);
        this._completedAsyncSpans.push(
            Object.freeze({
                ...span,
                endFrameNumber,
                endTime,
                durationMs: Math.max(0, endTime - span.startTime),
                status,
            }),
        );

        if (this._completedAsyncSpans.length > this._maxAsyncSpans) {
            this._completedAsyncSpans.shift();
        }

        this._revision += 1;
    }

    _CloseActiveAsyncSpans(endTime, endFrameNumber, status) {
        for (const span of this._activeAsyncSpans.values()) {
            this._CompleteAsyncSpan(span, endTime, endFrameNumber, status);
        }
    }

    _CloseScope(frame, scopeIndex, endTime, incomplete) {
        const scope = frame.scopes[scopeIndex];
        scope.endTime = endTime;
        scope.durationMs = Math.max(0, endTime - scope.startTime);
        scope.incomplete = incomplete;
    }
}

export function ProfileScope(profiler, name, callback, category = "function") {
    if (typeof callback !== "function") {
        throw new TypeError("ProfileScope requires a callback function.");
    }

    const token = profiler?.BeginScope(name, category) ?? null;

    try {
        return callback();
    } finally {
        profiler?.EndScope(token);
    }
}

export function ProfileFunction(
    profiler,
    name,
    callback,
    category = "function",
) {
    if (typeof callback !== "function") {
        throw new TypeError("ProfileFunction requires a callback function.");
    }

    return function (...argumentsList) {
        const token = profiler?.BeginScope(name, category) ?? null;

        try {
            return callback.apply(this, argumentsList);
        } finally {
            profiler?.EndScope(token);
        }
    };
}

export async function ProfileAsyncScope(
    profiler,
    name,
    callback,
    category = "function",
) {
    if (typeof callback !== "function") {
        throw new TypeError("ProfileAsyncScope requires a callback function.");
    }

    const token = profiler?.BeginAsyncScope(name, category) ?? null;

    try {
        return await callback();
    } finally {
        profiler?.EndAsyncScope(token);
    }
}

export function ProfileAsyncFunction(
    profiler,
    name,
    callback,
    category = "function",
) {
    if (typeof callback !== "function") {
        throw new TypeError("ProfileAsyncFunction requires a callback function.");
    }

    return async function (...argumentsList) {
        const token = profiler?.BeginAsyncScope(name, category) ?? null;

        try {
            return await callback.apply(this, argumentsList);
        } finally {
            profiler?.EndAsyncScope(token);
        }
    };
}
