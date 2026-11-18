import assert from "node:assert/strict";
import test from "node:test";
import { MemoryTracker } from "../../../src/diagnostics/profiling/memory-tracker.js";

function TrackResource(tracker, label, owner, bytes) {
    return tracker.TrackResource({
        label,
        resourceType: "Buffer",
        category: "GPU",
        bytes,
        owner,
    });
}

test("records per-frame allocation and release owners", () => {
    const tracker = new MemoryTracker();
    tracker.BeginFrame(1);

    const renderScope = tracker.BeginOwnerScope("RenderSystem");
    const resourceId = TrackResource(
        tracker,
        "Vertex buffer",
        null,
        512,
    );
    tracker.EndOwnerScope(renderScope);

    const allocationFrame = tracker.EndFrame();

    assert.equal(allocationFrame.allocatedBytes, 512);
    assert.equal(allocationFrame.releasedBytes, 0);
    assert.equal(allocationFrame.netBytes, 512);
    assert.equal(
        allocationFrame.changesByOwner.RenderSystem.allocatedBytes,
        512,
    );
    assert.equal(allocationFrame.events[0].owner, "RenderSystem");
    assert.equal(allocationFrame.events[0].resourceOwner, "RenderSystem");

    tracker.BeginFrame(2);
    const cleanupScope = tracker.BeginOwnerScope("CleanupSystem");
    assert.equal(tracker.ReleaseResource(resourceId), true);
    tracker.EndOwnerScope(cleanupScope);

    const releaseFrame = tracker.EndFrame();

    assert.equal(releaseFrame.allocatedBytes, 0);
    assert.equal(releaseFrame.releasedBytes, 512);
    assert.equal(releaseFrame.netBytes, -512);
    assert.equal(
        releaseFrame.changesByOwner.CleanupSystem.releasedBytes,
        512,
    );
    assert.equal(
        releaseFrame.ownerFilterTotals.RenderSystem.releasedBytes,
        512,
    );
    assert.equal(releaseFrame.events[0].owner, "CleanupSystem");
    assert.equal(releaseFrame.events[0].resourceOwner, "RenderSystem");
});

test("compares snapshot resource and owner deltas", () => {
    const tracker = new MemoryTracker();
    const rendererResourceId = TrackResource(
        tracker,
        "Renderer buffer",
        "RenderSystem",
        64,
    );
    const base = tracker.TakeSnapshot("Before");

    tracker.ReleaseResource(rendererResourceId);
    TrackResource(tracker, "Physics buffer", "PhysicsSystem", 128);
    const target = tracker.TakeSnapshot("After");
    const comparison = tracker.CompareSnapshots(
        base.snapshotId,
        target.snapshotId,
    );

    assert.equal(comparison.deltaBytes, 64);
    assert.equal(comparison.addedBytes, 128);
    assert.equal(comparison.releasedBytes, 64);
    assert.deepEqual(comparison.ownerChanges.RenderSystem, {
        beforeBytes: 64,
        afterBytes: 0,
        deltaBytes: -64,
    });
    assert.deepEqual(comparison.ownerChanges.PhysicsSystem, {
        beforeBytes: 0,
        afterBytes: 128,
        deltaBytes: 128,
    });
    assert.deepEqual(
        comparison.added.map(({ label }) => label),
        ["Physics buffer"],
    );
    assert.deepEqual(
        comparison.released.map(({ label }) => label),
        ["Renderer buffer"],
    );
});

test("tracks frame and live-resource revisions separately", () => {
    const tracker = new MemoryTracker();
    const initialRevision = tracker.Revision;
    const initialResourceRevision = tracker.ResourceRevision;

    tracker.BeginFrame(1);
    const resourceId = TrackResource(tracker, "Vertex buffer", null, 64);
    assert.equal(tracker.Revision, initialRevision + 1);
    assert.equal(tracker.ResourceRevision, initialResourceRevision + 1);

    tracker.EndFrame();
    assert.equal(tracker.Revision, initialRevision + 2);
    assert.equal(tracker.ResourceRevision, initialResourceRevision + 1);

    tracker.ReleaseResource(resourceId);
    assert.equal(tracker.Revision, initialRevision + 3);
    assert.equal(tracker.ResourceRevision, initialResourceRevision + 2);
});

test("keeps complete totals when per-frame event details are dropped", () => {
    const tracker = new MemoryTracker({ maxEventsPerFrame: 1 });
    tracker.BeginFrame(1);

    const firstResourceId = TrackResource(tracker, "First", "Renderer", 64);
    const secondResourceId = TrackResource(tracker, "Second", "Renderer", 128);

    const frame = tracker.EndFrame();

    assert.equal(frame.events.length, 1);
    assert.equal(frame.droppedEventCount, 1);
    assert.equal(frame.allocatedBytes, 192);
    assert.equal(frame.netBytes, 192);
    assert.equal(frame.changesByOwner.Renderer.allocatedBytes, 192);
    assert.equal(frame.changesByOwner.Renderer.droppedEventCount, 1);
    assert.equal(frame.ownerFilterTotals.Renderer.allocatedBytes, 192);
    assert.equal(frame.ownerFilterTotals.Renderer.droppedEventCount, 1);
    assert.equal(tracker.GetLiveUsage().totalBytes, 192);
    assert.equal(tracker.ReleaseResource(firstResourceId), true);
    assert.equal(tracker.ReleaseResource(secondResourceId), true);
});

test("keeps live byte and resource totals by owner", () => {
    const tracker = new MemoryTracker();
    const firstId = TrackResource(tracker, "First", "Renderer", 64);
    TrackResource(tracker, "Second", "Renderer", 128);
    TrackResource(tracker, "Third", "Physics", 32);

    assert.deepEqual({ ...tracker.GetLiveUsage().bytesByOwner }, {
        Renderer: 192,
        Physics: 32,
    });
    assert.deepEqual({ ...tracker.GetLiveUsage().resourceCountByOwner }, {
        Renderer: 2,
        Physics: 1,
    });

    tracker.ReleaseResource(firstId);

    assert.equal(tracker.GetLiveUsage().bytesByOwner.Renderer, 128);
    assert.equal(tracker.GetLiveUsage().resourceCountByOwner.Renderer, 1);
});
