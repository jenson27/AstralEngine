import assert from "node:assert/strict";
import test from "node:test";
import { GpuTimingTracker } from "../../src/graphics/gpu-timing-tracker.js";

function InstallGpuConstants(context) {
    const previous = new Map(
        ["GPUBufferUsage", "GPUMapMode"].map((name) => [
            name,
            Object.getOwnPropertyDescriptor(globalThis, name),
        ]),
    );
    Object.defineProperty(globalThis, "GPUBufferUsage", {
        configurable: true,
        value: { QUERY_RESOLVE: 1, COPY_SRC: 2, COPY_DST: 4, MAP_READ: 8 },
    });
    Object.defineProperty(globalThis, "GPUMapMode", {
        configurable: true,
        value: { READ: 1 },
    });
    context.after(() => {
        for (const [name, descriptor] of previous) {
            if (descriptor) {
                Object.defineProperty(globalThis, name, descriptor);
            } else {
                Reflect.deleteProperty(globalThis, name);
            }
        }
    });
}

function CreateTrackerFixture({ features = new Set(["timestamp-query"]), mapAsync } = {}) {
    const destroyed = [];
    const resolved = [];
    const copied = [];
    const resources = new Set();
    const records = [];
    const profiler = {
        IsEnabled: true,
        CurrentFrameNumber: 12,
        RecordGpuFrameTime: (...args) => records.push(args),
    };
    const memoryTracker = {
        TrackResource(resource) {
            const token = { resource };
            resources.add(token);
            return token;
        },
        ReleaseResource(token) { resources.delete(token); },
    };
    const device = {
        features,
        createQuerySet(descriptor) {
            return { descriptor, destroy: () => destroyed.push("querySet") };
        },
        createBuffer(descriptor) {
            const timestamps = new ArrayBuffer(16);
            const values = new BigUint64Array(timestamps);
            values[0] = 1_000_000n;
            values[1] = 4_500_000n;
            return {
                descriptor,
                destroy: () => destroyed.push("buffer"),
                mapAsync: () => mapAsync?.() ?? Promise.resolve(),
                getMappedRange: () => timestamps,
                unmap() {},
            };
        },
    };
    const tracker = new GpuTimingTracker(profiler, memoryTracker);
    return { copied, destroyed, device, profiler, records, resolved, resources, tracker };
}

function CreateCommandEncoder(resolved, copied) {
    return {
        resolveQuerySet(...args) { resolved.push(args); },
        copyBufferToBuffer(...args) { copied.push(args); },
    };
}

function WaitForTurn() {
    return new Promise((resolve) => setImmediate(resolve));
}

test("reports whether the device supports timestamp queries", (context) => {
    InstallGpuConstants(context);
    const unsupported = CreateTrackerFixture({ features: new Set() });
    unsupported.tracker.Initialize(unsupported.device);
    assert.equal(unsupported.tracker.IsSupported, false);
    assert.equal(unsupported.tracker.BeginFrame(), null);

    const supported = CreateTrackerFixture();
    supported.tracker.Initialize(supported.device);
    assert.equal(supported.tracker.IsSupported, true);
    supported.tracker.Destroy();
});

test("resolves public frame timing and ignores reads after destruction", async (context) => {
    InstallGpuConstants(context);
    const active = CreateTrackerFixture();
    active.tracker.Initialize(active.device);
    active.tracker.BeginFrame().Read(11);
    await WaitForTurn();
    assert.deepEqual(active.records, [[11, 3.5]]);
    active.tracker.Destroy();

    let finishMapping;
    const fixture = CreateTrackerFixture({
        mapAsync: () => new Promise((resolve) => { finishMapping = resolve; }),
    });
    fixture.tracker.Initialize(fixture.device);

    const frames = [
        fixture.tracker.BeginFrame(),
        fixture.tracker.BeginFrame(),
        fixture.tracker.BeginFrame(),
    ];
    assert.ok(frames.every(Boolean));
    assert.equal(fixture.tracker.BeginFrame(), null);
    frames[0].Cancel();
    const frame = fixture.tracker.BeginFrame();
    assert.ok(frame);
    assert.equal(frame.TimestampWrites.beginningOfPassWriteIndex, 0);
    assert.equal(frame.TimestampWrites.endOfPassWriteIndex, 1);

    const encoder = CreateCommandEncoder(fixture.resolved, fixture.copied);
    frame.Resolve(encoder);
    assert.equal(fixture.resolved.length, 1);
    assert.equal(fixture.copied.length, 1);
    frame.Read(12);

    fixture.tracker.Destroy();
    assert.equal(fixture.tracker.IsSupported, false);
    assert.equal(fixture.resources.size, 0);
    finishMapping();
    await WaitForTurn();

    assert.deepEqual(fixture.records, []);
    assert.equal(fixture.destroyed.filter((item) => item === "querySet").length, 1);
    assert.equal(fixture.destroyed.filter((item) => item === "buffer").length, 6);
});
