const DEFAULT_FRAME_CAPACITY = 600;
const DEFAULT_SNAPSHOT_CAPACITY = 12;
const DEFAULT_EVENT_CAPACITY_PER_FRAME = 1024;

function RequirePositiveInteger(value, name) {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new TypeError(name + " must be a positive integer.");
    }
}

function GetTotalBytes(bytesByOwner) {
    let totalBytes = 0;

    for (const bytes of bytesByOwner.values()) {
        totalBytes += bytes;
    }

    return totalBytes;
}

function CreateFrozenObjectFromMap(valuesByName) {
    const values = Object.create(null);

    for (const [name, value] of valuesByName) {
        values[name] = value;
    }

    return Object.freeze(values);
}

function CreateChangeTotals() {
    return {
        allocatedBytes: 0,
        releasedBytes: 0,
        allocationCount: 0,
        releaseCount: 0,
        estimatedEventCount: 0,
        droppedEventCount: 0,
    };
}

function AccumulateChange(totals, action, resource) {
    if (action === "allocate") {
        totals.allocatedBytes += resource.bytes;
        totals.allocationCount += 1;
    } else {
        totals.releasedBytes += resource.bytes;
        totals.releaseCount += 1;
    }

    if (resource.estimated) {
        totals.estimatedEventCount += 1;
    }
}

function GetOrCreateChangeTotals(changesByOwner, owner) {
    let totals = changesByOwner.get(owner);

    if (!totals) {
        totals = CreateChangeTotals();
        changesByOwner.set(owner, totals);
    }

    return totals;
}

function BuildResourceChanges(baseResources, targetResources) {
    const baseResourcesById = new Map(
        baseResources.map((resource) => [resource.resourceId, resource]),
    );
    const targetResourcesById = new Map(
        targetResources.map((resource) => [resource.resourceId, resource]),
    );
    const added = targetResources.filter(
        (resource) => !baseResourcesById.has(resource.resourceId),
    );
    const released = baseResources.filter(
        (resource) => !targetResourcesById.has(resource.resourceId),
    );

    return {
        added,
        released,
        addedBytes: added.reduce((total, resource) => total + resource.bytes, 0),
        releasedBytes: released.reduce(
            (total, resource) => total + resource.bytes,
            0,
        ),
    };
}

function BuildOwnerChanges(baseBytesByOwner, targetBytesByOwner) {
    const owners = new Set([
        ...Object.keys(baseBytesByOwner),
        ...Object.keys(targetBytesByOwner),
    ]);
    const ownerChanges = Object.create(null);

    for (const owner of owners) {
        const beforeBytes = baseBytesByOwner[owner] ?? 0;
        const afterBytes = targetBytesByOwner[owner] ?? 0;
        ownerChanges[owner] = Object.freeze({
            beforeBytes,
            afterBytes,
            deltaBytes: afterBytes - beforeBytes,
        });
    }

    return Object.freeze(ownerChanges);
}

function CreateCompletedFrame(frame, endingBytesByOwner) {
    for (const change of frame.changesByOwner.values()) {
        Object.freeze(change);
    }

    for (const totals of frame.ownerFilterTotals.values()) {
        Object.freeze(totals);
    }

    const frozenEvents = frame.events.map((event) =>
        Object.freeze({ ...event }),
    );

    return Object.freeze({
        frameNumber: frame.frameNumber,
        startingBytesByOwner: CreateFrozenObjectFromMap(
            frame.startingBytesByOwner,
        ),
        endingBytesByOwner: CreateFrozenObjectFromMap(endingBytesByOwner),
        liveBytes: GetTotalBytes(endingBytesByOwner),
        liveBytesByOwner: CreateFrozenObjectFromMap(endingBytesByOwner),
        allocatedBytes: frame.allocatedBytes,
        releasedBytes: frame.releasedBytes,
        netBytes:
            GetTotalBytes(endingBytesByOwner) -
            GetTotalBytes(frame.startingBytesByOwner),
        changesByOwner: CreateFrozenObjectFromMap(frame.changesByOwner),
        ownerFilterTotals: CreateFrozenObjectFromMap(
            frame.ownerFilterTotals,
        ),
        events: Object.freeze(frozenEvents),
        droppedEventCount: frame.droppedEventCount,
    });
}

export class MemoryTracker {
    constructor({
        maxFrames = DEFAULT_FRAME_CAPACITY,
        maxSnapshots = DEFAULT_SNAPSHOT_CAPACITY,
        maxEventsPerFrame = DEFAULT_EVENT_CAPACITY_PER_FRAME,
    } = {}) {
        RequirePositiveInteger(maxFrames, "maxFrames");
        RequirePositiveInteger(maxSnapshots, "maxSnapshots");
        RequirePositiveInteger(maxEventsPerFrame, "maxEventsPerFrame");

        this._maxFrames = maxFrames;
        this._maxSnapshots = maxSnapshots;
        this._maxEventsPerFrame = maxEventsPerFrame;
        this._frames = new Array(maxFrames);
        this._nextFrameIndex = 0;
        this._frameCount = 0;
        this._currentFrame = null;
        this._resourcesById = new Map();
        this._liveBytesByOwner = new Map();
        this._liveResourceCountByOwner = new Map();
        this._snapshotsById = new Map();
        this._snapshotIds = [];
        this._ownerStack = [];
        this._nextResourceId = 1;
        this._nextSnapshotId = 1;
        this._revision = 0;
        this._resourceRevision = 0;
    }

    get Revision() {
        return this._revision;
    }

    get ResourceRevision() {
        return this._resourceRevision;
    }

    get CurrentOwner() {
        if (this._ownerStack.length === 0) {
            return null;
        }

        return this._ownerStack[this._ownerStack.length - 1].owner;
    }

    BeginFrame(frameNumber) {
        if (!Number.isSafeInteger(frameNumber) || frameNumber < 0) {
            throw new TypeError("Frame number must be a non-negative integer.");
        }

        if (this._currentFrame !== null) {
            throw new Error("A memory tracking frame is already active.");
        }

        this._currentFrame = {
            frameNumber,
            startingBytesByOwner: this._GetLiveBytesByOwner(),
            events: [],
            allocatedBytes: 0,
            releasedBytes: 0,
            changesByOwner: new Map(),
            ownerFilterTotals: new Map(),
            droppedEventCount: 0,
        };
    }

    EndFrame() {
        if (this._currentFrame === null) {
            return null;
        }

        const frame = this._currentFrame;
        const endingBytesByOwner = this._GetLiveBytesByOwner();
        const completedFrame = CreateCompletedFrame(
            frame,
            endingBytesByOwner,
        );

        this._frames[this._nextFrameIndex] = completedFrame;
        this._nextFrameIndex =
            (this._nextFrameIndex + 1) % this._maxFrames;
        this._frameCount = Math.min(
            this._frameCount + 1,
            this._maxFrames,
        );
        this._currentFrame = null;
        this._revision += 1;

        return completedFrame;
    }

    BeginOwnerScope(owner) {
        if (typeof owner !== "string" || owner.trim() === "") {
            throw new TypeError("Memory owner must be a non-empty string.");
        }

        const token = { owner };
        this._ownerStack.push(token);
        return token;
    }

    EndOwnerScope(token) {
        if (token === null || token === undefined) {
            return;
        }

        if (this._ownerStack[this._ownerStack.length - 1] !== token) {
            throw new Error("Memory owner scopes must end in reverse start order.");
        }

        this._ownerStack.pop();
    }

    TrackResource({
        label,
        resourceType,
        category,
        bytes,
        owner = null,
        estimated = false,
    }) {
        if (typeof label !== "string" || label.trim() === "") {
            throw new TypeError("Memory resource label must be non-empty.");
        }

        if (
            typeof resourceType !== "string" ||
            resourceType.trim() === ""
        ) {
            throw new TypeError("Memory resource type must be non-empty.");
        }

        if (typeof category !== "string" || category.trim() === "") {
            throw new TypeError("Memory resource category must be non-empty.");
        }

        if (!Number.isSafeInteger(bytes) || bytes < 0) {
            throw new TypeError("Memory resource bytes must be a non-negative integer.");
        }

        if (owner !== null && (typeof owner !== "string" || owner.trim() === "")) {
            throw new TypeError("Memory resource owner must be a non-empty string or null.");
        }

        if (typeof estimated !== "boolean") {
            throw new TypeError("Memory resource estimated flag must be a boolean.");
        }

        const resourceId = this._nextResourceId;
        this._nextResourceId += 1;

        const resolvedOwner =
            owner ?? this.CurrentOwner ?? "Unattributed";
        const resource = Object.freeze({
            resourceId,
            label,
            resourceType,
            category,
            bytes,
            owner: resolvedOwner,
            estimated,
            allocatedFrameNumber:
                this._currentFrame?.frameNumber ?? null,
        });

        this._resourcesById.set(resourceId, resource);
        this._AdjustLiveResourceTotals(resource, 1);
        this._revision += 1;
        this._resourceRevision += 1;
        this._RecordEvent("allocate", resource, resolvedOwner);
        return resourceId;
    }

    ReleaseResource(resourceId) {
        if (resourceId === null || resourceId === undefined) {
            return false;
        }

        const resource = this._resourcesById.get(resourceId);

        if (!resource) {
            return false;
        }

        this._resourcesById.delete(resourceId);
        this._AdjustLiveResourceTotals(resource, -1);
        this._revision += 1;
        this._resourceRevision += 1;
        this._RecordEvent(
            "release",
            resource,
            this.CurrentOwner ?? resource.owner,
        );
        return true;
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

    GetLiveResources() {
        return [...this._resourcesById.values()];
    }

    GetLiveUsage() {
        const bytesByOwner = this._GetLiveBytesByOwner();

        return Object.freeze({
            resourceCount: this._resourcesById.size,
            totalBytes: GetTotalBytes(bytesByOwner),
            bytesByOwner: CreateFrozenObjectFromMap(bytesByOwner),
            resourceCountByOwner: CreateFrozenObjectFromMap(
                this._liveResourceCountByOwner,
            ),
        });
    }

    TakeSnapshot(label = "Snapshot") {
        if (typeof label !== "string" || label.trim() === "") {
            throw new TypeError("Memory snapshot label must be non-empty.");
        }

        const snapshotId = this._nextSnapshotId;
        this._nextSnapshotId += 1;
        const resources = [...this._resourcesById.values()].map((resource) =>
            Object.freeze({ ...resource }),
        );
        const bytesByOwner = this._GetLiveBytesByOwner();
        const snapshot = Object.freeze({
            snapshotId,
            label,
            timestamp: performance.now(),
            resourceCount: resources.length,
            totalBytes: GetTotalBytes(bytesByOwner),
            bytesByOwner: CreateFrozenObjectFromMap(bytesByOwner),
            resources: Object.freeze(resources),
        });

        this._snapshotsById.set(snapshotId, snapshot);
        this._snapshotIds.push(snapshotId);

        if (this._snapshotIds.length > this._maxSnapshots) {
            const removedSnapshotId = this._snapshotIds.shift();
            this._snapshotsById.delete(removedSnapshotId);
        }

        return snapshot;
    }

    GetSnapshots() {
        return this._snapshotIds.map((snapshotId) =>
            this._snapshotsById.get(snapshotId),
        );
    }

    CompareSnapshots(baseSnapshotId, targetSnapshotId) {
        const baseSnapshot = this._RequireSnapshot(baseSnapshotId);
        const targetSnapshot = this._RequireSnapshot(targetSnapshotId);
        const resourceChanges = BuildResourceChanges(
            baseSnapshot.resources,
            targetSnapshot.resources,
        );
        const ownerChanges = BuildOwnerChanges(
            baseSnapshot.bytesByOwner,
            targetSnapshot.bytesByOwner,
        );

        return Object.freeze({
            baseSnapshotId,
            targetSnapshotId,
            deltaBytes: targetSnapshot.totalBytes - baseSnapshot.totalBytes,
            addedBytes: resourceChanges.addedBytes,
            releasedBytes: resourceChanges.releasedBytes,
            ownerChanges,
            added: Object.freeze(resourceChanges.added),
            released: Object.freeze(resourceChanges.released),
        });
    }

    async SampleBrowserMemory() {
        const measureMemory =
            globalThis.performance?.measureUserAgentSpecificMemory;

        if (typeof measureMemory !== "function") {
            return Object.freeze({
                supported: false,
                reason: "Browser memory sampling is not supported here.",
            });
        }

        try {
            const result = await measureMemory.call(globalThis.performance);
            return Object.freeze({
                supported: true,
                timestamp: performance.now(),
                bytes: result.bytes,
                breakdown: Object.freeze(
                    (result.breakdown ?? []).map((item) =>
                        Object.freeze({
                            bytes: item.bytes,
                            attribution: item.attribution,
                            types: item.types,
                        }),
                    ),
                ),
            });
        } catch (error) {
            return Object.freeze({
                supported: false,
                reason:
                    error instanceof Error
                        ? error.message
                        : String(error),
            });
        }
    }

    _RecordEvent(action, resource, owner) {
        const frame = this._currentFrame;

        if (frame === null) {
            return;
        }

        const ownerTotals = GetOrCreateChangeTotals(
            frame.changesByOwner,
            owner,
        );
        AccumulateChange(ownerTotals, action, resource);

        frame.allocatedBytes += action === "allocate" ? resource.bytes : 0;
        frame.releasedBytes += action === "release" ? resource.bytes : 0;

        const filterOwners = owner === resource.owner
            ? [owner]
            : [owner, resource.owner];

        for (const filterOwner of filterOwners) {
            const totals = GetOrCreateChangeTotals(
                frame.ownerFilterTotals,
                filterOwner,
            );
            AccumulateChange(totals, action, resource);
        }

        if (frame.events.length >= this._maxEventsPerFrame) {
            frame.droppedEventCount += 1;
            ownerTotals.droppedEventCount += 1;

            for (const filterOwner of filterOwners) {
                frame.ownerFilterTotals.get(filterOwner).droppedEventCount += 1;
            }

            return;
        }

        frame.events.push({
            action,
            resourceId: resource.resourceId,
            label: resource.label,
            resourceType: resource.resourceType,
            category: resource.category,
            bytes: resource.bytes,
            owner,
            resourceOwner: resource.owner,
            estimated: resource.estimated,
        });
    }

    _GetLiveBytesByOwner() {
        return new Map(this._liveBytesByOwner);
    }

    _AdjustLiveResourceTotals(resource, direction) {
        const owner = resource.owner;

        if (direction > 0) {
            this._liveBytesByOwner.set(
                owner,
                (this._liveBytesByOwner.get(owner) ?? 0) + resource.bytes,
            );
            this._liveResourceCountByOwner.set(
                owner,
                (this._liveResourceCountByOwner.get(owner) ?? 0) + 1,
            );
            return;
        }

        const resourceCount = this._liveResourceCountByOwner.get(owner) ?? 0;

        if (resourceCount <= 1) {
            this._liveBytesByOwner.delete(owner);
            this._liveResourceCountByOwner.delete(owner);
            return;
        }

        this._liveBytesByOwner.set(
            owner,
            (this._liveBytesByOwner.get(owner) ?? 0) - resource.bytes,
        );
        this._liveResourceCountByOwner.set(owner, resourceCount - 1);
    }

    _RequireSnapshot(snapshotId) {
        const snapshot = this._snapshotsById.get(snapshotId);

        if (!snapshot) {
            throw new Error("Memory snapshot was not found: " + snapshotId);
        }

        return snapshot;
    }
}
