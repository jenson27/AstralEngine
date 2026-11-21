export class AssetScope {
    constructor(assetManager) {
        if (!assetManager || typeof assetManager.Acquire !== "function") {
            throw new TypeError(
                "AssetScope requires an asset manager.",
            );
        }

        this._assetManager = assetManager;
        this._leasesByAssetId = new Map();
        this._acquisitionsByAssetId = new Map();
        this._state = "open";
        this._releasePromise = null;
        this._retainedAssetIds = null;
        this._retentionRevision = 0;
        this._retentionPromise = null;
    }

    Acquire(assetId) {
        this._RequireOpen();
        this._RequireAssetId(assetId);
        this._retentionRevision += 1;
        this._retainedAssetIds?.add(assetId);

        const existingLease = this._leasesByAssetId.get(assetId);
        if (existingLease) {
            return Promise.resolve(existingLease.Asset);
        }

        const existingAcquisition =
            this._acquisitionsByAssetId.get(assetId);
        if (existingAcquisition) {
            return existingAcquisition.promise;
        }

        const acquisition = { promise: null };

        acquisition.promise = Promise.resolve()
            .then(() => this._assetManager.Acquire(assetId))
            .then(async (lease) => {
                if (this._state !== "open") {
                    await lease.Release();
                    throw new Error(
                        "Asset scope closed while acquiring: " + assetId,
                    );
                }

                this._leasesByAssetId.set(assetId, lease);
                return lease.Asset;
            })
            .finally(() => {
                if (
                    this._acquisitionsByAssetId.get(assetId) ===
                    acquisition
                ) {
                    this._acquisitionsByAssetId.delete(assetId);
                }
            });

        this._acquisitionsByAssetId.set(assetId, acquisition);
        return acquisition.promise;
    }

    Get(assetId) {
        this._RequireOpen();
        this._RequireAssetId(assetId);

        const lease = this._leasesByAssetId.get(assetId);
        return lease?.Asset;
    }

    GetRequired(assetId) {
        const asset = this.Get(assetId);

        if (asset === undefined) {
            throw new Error(
                "Asset has not been acquired by this scope: " + assetId,
            );
        }

        return asset;
    }

    GetHandle(assetId) {
        this._RequireOpen();
        this._RequireAssetId(assetId);

        const lease = this._leasesByAssetId.get(assetId);
        return lease?.Handle;
    }

    GetHandleRequired(assetId) {
        const handle = this.GetHandle(assetId);

        if (handle === undefined) {
            throw new Error(
                "Asset has not been acquired by this scope: " + assetId,
            );
        }

        return handle;
    }

    RetainOnly(assetIds) {
        this._RequireOpen();
        if (
            !Array.isArray(assetIds) ||
            !assetIds.every(
                (assetId) =>
                    typeof assetId === "string" && assetId.trim() !== "",
            )
        ) {
            throw new TypeError("Retained asset IDs must be an array of strings.");
        }

        this._retainedAssetIds = new Set(assetIds);
        this._retentionRevision += 1;
        if (!this._retentionPromise) {
            this._retentionPromise = this._DrainRetainedAssets().finally(() => {
                this._retentionPromise = null;
            });
        }
        return this._retentionPromise;
    }

    ReleaseAll() {
        if (this._state === "disposed") {
            return Promise.resolve();
        }

        if (this._releasePromise) {
            return this._releasePromise;
        }

        this._state = "disposing";
        this._releasePromise = this._ReleaseAll();
        return this._releasePromise;
    }

    async _ReleaseAll() {
        const pendingAcquisitions = Array.from(
            this._acquisitionsByAssetId.values(),
            (acquisition) => acquisition.promise,
        );

        await Promise.allSettled(pendingAcquisitions);
        await Promise.allSettled([this._retentionPromise]);

        const leases = Array.from(this._leasesByAssetId.values());
        this._leasesByAssetId.clear();

        const releaseResults = await Promise.allSettled(
            leases.map((lease) => lease.Release()),
        );

        this._state = "disposed";

        const errors = releaseResults
            .filter((result) => result.status === "rejected")
            .map((result) => result.reason);

        if (errors.length > 0) {
            throw new AggregateError(
                errors,
                "One or more scoped assets failed to release.",
            );
        }
    }

    async _DrainRetainedAssets() {
        while (this._state === "open") {
            const revision = this._retentionRevision;
            const pendingAcquisitions = Array.from(
                this._acquisitionsByAssetId.values(),
                (acquisition) => acquisition.promise,
            );
            if (pendingAcquisitions.length > 0) {
                await Promise.allSettled(pendingAcquisitions);
            }
            if (this._state !== "open") {
                return;
            }
            if (revision !== this._retentionRevision) {
                continue;
            }

            const leasesToRelease = [];
            for (const [assetId, lease] of this._leasesByAssetId) {
                if (!this._retainedAssetIds.has(assetId)) {
                    this._leasesByAssetId.delete(assetId);
                    leasesToRelease.push(lease);
                }
            }

            const releaseResults = await Promise.allSettled(
                leasesToRelease.map((lease) => lease.Release()),
            );
            const errors = releaseResults
                .filter((result) => result.status === "rejected")
                .map((result) => result.reason);
            if (errors.length > 0) {
                throw new AggregateError(
                    errors,
                    "One or more unused scoped assets failed to release.",
                );
            }

            if (
                revision === this._retentionRevision &&
                this._acquisitionsByAssetId.size === 0
            ) {
                return;
            }
        }
    }

    _RequireOpen() {
        if (this._state !== "open") {
            throw new Error("Asset scope is not open.");
        }
    }

    _RequireAssetId(assetId) {
        if (typeof assetId !== "string" || assetId.trim() === "") {
            throw new TypeError(
                "Asset ID must be a non-empty string.",
            );
        }
    }
}
