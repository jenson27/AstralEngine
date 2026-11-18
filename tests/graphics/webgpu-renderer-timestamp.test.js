import assert from "node:assert/strict";
import test from "node:test";
import { WebGPURenderer } from "../../src/graphics/webgpu-renderer.js";

function InstallWebGpuGlobals(testContext, adapter) {
    const previous = new Map(
        ["navigator", "GPUBufferUsage"].map((name) => [
            name,
            Object.getOwnPropertyDescriptor(globalThis, name),
        ]),
    );

    Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { gpu: { requestAdapter: async () => adapter } },
    });
    Object.defineProperty(globalThis, "GPUBufferUsage", {
        configurable: true,
        value: {
            QUERY_RESOLVE: 1,
            COPY_SRC: 2,
            COPY_DST: 4,
            MAP_READ: 8,
        },
    });

    testContext.after(() => {
        for (const [name, descriptor] of previous) {
            if (descriptor) {
                Object.defineProperty(globalThis, name, descriptor);
            } else {
                Reflect.deleteProperty(globalThis, name);
            }
        }
    });
}

function CreateFakeDevice(features) {
    const state = { querySets: [], buffers: [], destroyed: false };
    const device = {
        features,
        lost: Promise.resolve({ reason: "destroyed" }),
        addEventListener() {},
        createQuerySet(descriptor) {
            const querySet = { descriptor, destroyed: false, destroy() { this.destroyed = true; } };
            state.querySets.push(querySet);
            return querySet;
        },
        createBuffer(descriptor) {
            const buffer = { descriptor, destroyed: false, destroy() { this.destroyed = true; } };
            state.buffers.push(buffer);
            return buffer;
        },
        destroy() {
            state.destroyed = true;
        },
    };

    return { device, state };
}

function CreateMemoryTracker() {
    let nextId = 1;
    const tracked = new Set();

    return {
        tracked,
        TrackResource() {
            const id = nextId++;
            tracked.add(id);
            return id;
        },
        ReleaseResource(id) {
            tracked.delete(id);
        },
    };
}

test("enables GPU timing when the adapter supports timestamp queries", async (context) => {
    const { device, state } = CreateFakeDevice(new Set(["timestamp-query"]));
    let requestDescriptor;
    const adapter = {
        features: new Set(["timestamp-query"]),
        requestDevice: async (descriptor) => {
            requestDescriptor = descriptor;
            return device;
        },
    };
    InstallWebGpuGlobals(context, adapter);
    const memoryTracker = CreateMemoryTracker();
    const profiler = {
        IsEnabled: true,
        RecordGpuFrameTime() {},
    };
    const renderer = new WebGPURenderer({}, memoryTracker, profiler);

    await renderer._InitializeDevice();

    assert.deepEqual(requestDescriptor.requiredFeatures, ["timestamp-query"]);
    assert.equal(renderer.GpuTimingSupported, true);
    assert.equal(state.querySets[0].descriptor.count, 6);
    assert.equal(state.buffers.length, 6);
    assert.equal(memoryTracker.tracked.size, 6);

    renderer.Shutdown();
    assert.equal(state.querySets[0].destroyed, true);
    assert.ok(state.buffers.every((buffer) => buffer.destroyed));
    assert.equal(memoryTracker.tracked.size, 0);
});

test("keeps GPU timing disabled when the adapter lacks timestamp queries", async (context) => {
    const { device, state } = CreateFakeDevice(new Set());
    let requestDescriptor = "unset";
    const adapter = {
        features: new Set(),
        requestDevice: async (descriptor) => {
            requestDescriptor = descriptor;
            return device;
        },
    };
    InstallWebGpuGlobals(context, adapter);
    const profiler = {
        IsEnabled: true,
        RecordGpuFrameTime() {},
    };
    const renderer = new WebGPURenderer({}, null, profiler);

    await renderer._InitializeDevice();

    assert.equal(requestDescriptor, undefined);
    assert.equal(renderer.GpuTimingSupported, false);
    assert.equal(state.querySets.length, 0);
    assert.equal(state.buffers.length, 0);

    renderer.Shutdown();
});
