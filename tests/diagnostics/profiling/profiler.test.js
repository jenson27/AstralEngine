import assert from "node:assert/strict";
import test from "node:test";
import {
    ProfileAsyncFunction,
    ProfileAsyncScope,
    ProfileFunction,
    ProfileScope,
    Profiler,
} from "../../../src/diagnostics/profiling/profiler.js";

test("records nested scopes and closes them in order", () => {
    const profiler = new Profiler();
    profiler.BeginFrame(1);

    const parent = profiler.BeginScope("RenderSystem", "system");
    const child = profiler.BeginScope("UploadVertices");
    profiler.EndScope(child);
    profiler.EndScope(parent);

    const frame = profiler.EndFrame();

    assert.deepEqual(
        frame.scopes.map(({ name, category, parentScopeIndex }) => ({
            name,
            category,
            parentScopeIndex,
        })),
        [
            {
                name: "RenderSystem",
                category: "system",
                parentScopeIndex: null,
            },
            {
                name: "UploadVertices",
                category: "function",
                parentScopeIndex: 0,
            },
        ],
    );
    assert.ok(frame.scopes[0].durationMs >= frame.scopes[1].durationMs);
    assert.ok(frame.scopes.every((scope) => scope.incomplete === false));
    assert.equal(frame.scopes[0].isAsync, false);
});

test("closes ProfileScope when its callback throws", () => {
    const profiler = new Profiler();
    const expectedError = new Error("Expected callback failure.");
    profiler.BeginFrame(2);

    assert.throws(
        () =>
            ProfileScope(profiler, "ThrowingFunction", () => {
                throw expectedError;
            }),
        (error) => error === expectedError,
    );

    const frame = profiler.EndFrame();

    assert.equal(frame.scopes.length, 1);
    assert.equal(frame.scopes[0].incomplete, false);
});

test("ProfileFunction preserves arguments and its receiver", () => {
    const profiler = new Profiler();
    profiler.BeginFrame(3);

    const calculate = ProfileFunction(
        profiler,
        "Calculate",
        function (value) {
            return this.offset + value;
        },
    );
    const calculator = { offset: 4, calculate };

    assert.equal(calculator.calculate(7), 11);

    const frame = profiler.EndFrame();

    assert.equal(frame.scopes[0].name, "Calculate");
    assert.equal(frame.scopes[0].incomplete, false);
});

test("counts scopes dropped after the per-frame capacity is reached", () => {
    const profiler = new Profiler({ maxScopesPerFrame: 1 });
    profiler.BeginFrame(4);

    const scope = profiler.BeginScope("Kept");
    assert.equal(profiler.BeginScope("Dropped"), null);
    profiler.EndScope(scope);

    const frame = profiler.EndFrame();

    assert.equal(frame.scopes.length, 1);
    assert.equal(frame.droppedScopeCount, 1);
});

test("tracks overlapping async scopes independently", async () => {
    const profiler = new Profiler();
    profiler.BeginFrame(5);

    let resolveFirst;
    let resolveSecond;
    const first = ProfileAsyncScope(
        profiler,
        "FirstAsyncTask",
        () => new Promise((resolve) => (resolveFirst = resolve)),
    );
    const second = ProfileAsyncScope(
        profiler,
        "SecondAsyncTask",
        () => new Promise((resolve) => (resolveSecond = resolve)),
    );

    resolveSecond();
    await second;
    resolveFirst();
    await first;

    const frame = profiler.EndFrame();

    assert.deepEqual(
        frame.scopes.map(({ name, parentScopeIndex, incomplete }) => ({
            name,
            parentScopeIndex,
            incomplete,
        })),
        [
            {
                name: "FirstAsyncTask",
                parentScopeIndex: null,
                incomplete: false,
            },
            {
                name: "SecondAsyncTask",
                parentScopeIndex: null,
                incomplete: false,
            },
        ],
    );
    assert.ok(frame.scopes.every((scope) => scope.isAsync));
});

test("marks unfinished async scopes incomplete at frame end", async () => {
    const profiler = new Profiler();
    profiler.BeginFrame(6);

    let resolveTask;
    const task = ProfileAsyncScope(
        profiler,
        "LateAsyncTask",
        () => new Promise((resolve) => (resolveTask = resolve)),
    );
    const frame = profiler.EndFrame();

    assert.equal(frame.scopes[0].incomplete, true);
    resolveTask();
    await task;
});

test("tracks async spans across frames", () => {
    const profiler = new Profiler();
    profiler.BeginFrame(10);
    const token = profiler.BeginAsyncScope("AssetLoad", "asset");
    const startFrame = profiler.EndFrame();

    assert.equal(startFrame.scopes[0].incomplete, true);
    assert.equal(profiler.GetAsyncSpans()[0].status, "running");

    profiler.BeginFrame(11);
    profiler.EndAsyncScope(token);
    profiler.EndFrame();

    assert.deepEqual(
        profiler.GetAsyncSpans().map(
            ({ startFrameNumber, endFrameNumber, status }) => ({
                startFrameNumber,
                endFrameNumber,
                status,
            }),
        ),
        [
            {
                startFrameNumber: 10,
                endFrameNumber: 11,
                status: "complete",
            },
        ],
    );
});

test("marks active async spans incomplete when capture stops", () => {
    const profiler = new Profiler();
    profiler.BeginFrame(12);
    profiler.BeginAsyncScope("AssetLoad", "asset");

    profiler.SetEnabled(false);

    assert.deepEqual(
        profiler.GetAsyncSpans().map(
            ({ endFrameNumber, status }) => ({ endFrameNumber, status }),
        ),
        [{ endFrameNumber: 12, status: "incomplete" }],
    );
});

test("counts async spans dropped at the active span limit", () => {
    const profiler = new Profiler({ maxAsyncSpans: 1 });
    profiler.BeginFrame(13);
    const token = profiler.BeginAsyncScope("Kept");

    assert.equal(profiler.BeginAsyncScope("Dropped"), null);
    assert.equal(profiler.DroppedAsyncSpanCount, 1);

    profiler.EndAsyncScope(token);
    profiler.EndFrame();

    assert.equal(profiler.GetAsyncSpans().length, 1);
});

test("ProfileAsyncFunction preserves its receiver and waits for completion", async () => {
    const profiler = new Profiler();
    profiler.BeginFrame(7);

    const calculate = ProfileAsyncFunction(
        profiler,
        "CalculateAsync",
        async function (value) {
            await Promise.resolve();
            return this.offset + value;
        },
    );
    const calculator = { offset: 4, calculate };

    assert.equal(await calculator.calculate(7), 11);
    const frame = profiler.EndFrame();

    assert.equal(frame.scopes[0].name, "CalculateAsync");
    assert.equal(frame.scopes[0].incomplete, false);
});

test("keeps GPU timings only while their frames are retained", () => {
    const profiler = new Profiler({ maxFrames: 1 });
    profiler.BeginFrame(8);
    profiler.EndFrame();

    assert.equal(profiler.RecordGpuFrameTime(8, 3.5), true);
    assert.equal(profiler.GetGpuFrameTime(8), 3.5);

    profiler.BeginFrame(9);
    profiler.EndFrame();

    assert.equal(profiler.GetGpuFrameTime(8), null);
    assert.equal(profiler.RecordGpuFrameTime(8, 4), false);
});
