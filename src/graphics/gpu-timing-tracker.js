import { AstralLogger } from "../diagnostics/logger.js";

const GPU_TIMING_SLOT_COUNT = 3;
const GPU_TIMESTAMP_PAIR_BYTES = 16;

export class GpuTimingTracker {
    constructor(profiler, memoryTracker) {
        this._profiler = profiler;
        this._memoryTracker = memoryTracker;
        this._device = null;
        this._isSupported = false;
        this._querySet = null;
        this._slots = [];
        this._generation = 0;
    }

    get IsSupported() {
        return this._isSupported;
    }

    Initialize(device) {
        this._device = device;
        if (!this._profiler || !device.features.has("timestamp-query")) {
            return;
        }

        try {
            this._querySet = device.createQuerySet({
                type: "timestamp",
                count: GPU_TIMING_SLOT_COUNT * 2,
            });

            for (let index = 0; index < GPU_TIMING_SLOT_COUNT; index += 1) {
                this._CreateSlot(index * 2);
            }

            this._isSupported = true;
        } catch (error) {
            this.Destroy();
            AstralLogger.Warn(
                "GPU timestamp queries could not be initialized.",
                error,
            );
        }
    }

    BeginFrame() {
        if (
            !this._isSupported ||
            !this._profiler?.IsEnabled ||
            this._profiler.CurrentFrameNumber === null
        ) {
            return null;
        }

        const slot = this._slots.find((candidate) => !candidate.busy);
        if (!slot) {
            return null;
        }

        slot.busy = true;
        return {
            TimestampWrites: {
                querySet: this._querySet,
                beginningOfPassWriteIndex: slot.queryIndex,
                endOfPassWriteIndex: slot.queryIndex + 1,
            },
            Resolve: (commandEncoder) => this._Resolve(commandEncoder, slot),
            Read: (frameNumber) => this._Read(slot, frameNumber),
            Cancel: () => {
                slot.busy = false;
            },
        };
    }

    Destroy() {
        this._generation += 1;
        this._isSupported = false;
        this._querySet?.destroy();
        this._querySet = null;

        for (const slot of this._slots) {
            slot.resolveBuffer?.destroy();
            slot.readBuffer?.destroy();
            this._memoryTracker?.ReleaseResource(
                slot.resolveMemoryToken,
            );
            this._memoryTracker?.ReleaseResource(slot.readMemoryToken);
        }

        this._slots.length = 0;
    }

    _CreateSlot(queryIndex) {
        const slot = {
            queryIndex,
            busy: false,
            resolveBuffer: null,
            readBuffer: null,
            resolveMemoryToken: null,
            readMemoryToken: null,
        };
        this._slots.push(slot);
        slot.resolveBuffer = this._device.createBuffer({
            size: GPU_TIMESTAMP_PAIR_BYTES,
            usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
        });
        slot.readBuffer = this._device.createBuffer({
            size: GPU_TIMESTAMP_PAIR_BYTES,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        slot.resolveMemoryToken = this._TrackResource(
            "GPU timing resolve buffer",
        );
        slot.readMemoryToken = this._TrackResource(
            "GPU timing readback buffer",
        );
    }

    _Resolve(commandEncoder, slot) {
        commandEncoder.resolveQuerySet(
            this._querySet,
            slot.queryIndex,
            2,
            slot.resolveBuffer,
            0,
        );
        commandEncoder.copyBufferToBuffer(
            slot.resolveBuffer,
            0,
            slot.readBuffer,
            0,
            GPU_TIMESTAMP_PAIR_BYTES,
        );
    }

    _Read(slot, frameNumber) {
        const generation = this._generation;

        void slot.readBuffer
            .mapAsync(GPUMapMode.READ)
            .then(() => {
                const timestamps = new BigUint64Array(
                    slot.readBuffer.getMappedRange(),
                );
                const startTimestamp = timestamps[0];
                const endTimestamp = timestamps[1];
                slot.readBuffer.unmap();

                if (
                    generation === this._generation &&
                    endTimestamp >= startTimestamp
                ) {
                    this._profiler.RecordGpuFrameTime(
                        frameNumber,
                        Number(endTimestamp - startTimestamp) / 1_000_000,
                    );
                }
            })
            .catch(() => {})
            .finally(() => {
                slot.busy = false;
            });
    }

    _TrackResource(label) {
        if (!this._memoryTracker) {
            return null;
        }

        return this._memoryTracker.TrackResource({
            label,
            resourceType: "GPUBuffer",
            category: "gpu-resource",
            bytes: GPU_TIMESTAMP_PAIR_BYTES,
            owner:
                this._memoryTracker.CurrentOwner ?? "WebGPURenderer",
            estimated: true,
        });
    }
}
