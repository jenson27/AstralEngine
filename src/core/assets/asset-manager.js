import { AstralLogger } from "../../diagnostics/logger.js";
import { AssetHandle } from "./asset-handle.js";
import { AssetLease } from "./asset-lease.js";
import { AssetDependencyResolver } from "./asset-dependency-resolver.js";

function GetAssetMemoryDetails(asset) {
    if (Number.isSafeInteger(asset?.MemoryUsageBytes)) {
        return {
            resourceType: asset.constructor?.name ?? "CPU asset",
            bytes: asset.MemoryUsageBytes,
            estimated: asset.MemoryUsageEstimated === true,
        };
    }

    if (
        asset?.bitmap &&
        Number.isSafeInteger(asset.width) &&
        Number.isSafeInteger(asset.height) &&
        asset.width > 0 &&
        asset.height > 0
    ) {
        return {
            resourceType: "ImageBitmap",
            bytes: asset.width * asset.height * 4,
            estimated: true,
        };
    }

    return null;
}

export class AssetManager {
    constructor(assetCatalog, loaderRegistry, memoryTracker = null) {
        if (
            !assetCatalog ||
            typeof assetCatalog.GetRequired !== "function"
        ) {
            throw new TypeError(
                "AssetManager requires an asset catalog.",
            );
        }

        if (
            !loaderRegistry ||
            typeof loaderRegistry.GetRequired !== "function"
        ) {
            throw new TypeError(
                "AssetManager requires an asset loader registry.",
            );
        }

        if (
            memoryTracker !== null &&
            typeof memoryTracker.TrackResource !== "function"
        ) {
            throw new TypeError(
                "AssetManager memory tracker must provide TrackResource().",
            );
        }

        this._assetCatalog = assetCatalog;
        this._loaderRegistry = loaderRegistry;
        this._memoryTracker = memoryTracker;
        this._dependencyResolver = new AssetDependencyResolver(assetCatalog);
        this._entriesById = new Map();
        this._statesByAssetId = new Map();
        this._stagedReload = null;
    }

    async Acquire(assetId) {
        this._RequireAssetId(assetId);

        while (this._stagedReload) {
            await this._stagedReload.completionPromise;
        }

        this._dependencyResolver.Validate(assetId);

        return this._Acquire(assetId);
    }

    async _Acquire(assetId) {
        while (true) {
            let entry = this._entriesById.get(assetId);

            if (entry?.state === "releasing") {
                await entry.releasePromise;
                continue;
            }

            if (!entry) {
                entry = this._CreateEntry(assetId);
            }

            entry.referenceCount += 1;

            try {
                await entry.promise;

                return new AssetLease(entry.handle, () =>
                    this._Release(entry),
                );
            } catch (error) {
                entry.referenceCount -= 1;
                throw error;
            }
        }
    }

    GetState(assetId) {
        this._RequireAssetId(assetId);
        return this._statesByAssetId.get(assetId) ?? "unloaded";
    }

    GetLoadedAssetIds() {
        return Array.from(this._entriesById.values())
            .filter((entry) => entry.state === "loaded")
            .map((entry) => entry.assetId);
    }

    async StageReload(assetIds) {
        if (this._stagedReload) {
            throw new Error("An asset reload transaction is already active.");
        }

        const requestedIds = Array.isArray(assetIds)
            ? [...new Set(assetIds)]
            : [assetIds];

        if (requestedIds.length === 0) {
            throw new TypeError(
                "Asset reload requires at least one asset ID.",
            );
        }

        for (const assetId of requestedIds) {
            this._RequireAssetId(assetId);
            this._dependencyResolver.Validate(assetId);
        }

        const transaction = this._CreateReloadTransaction(requestedIds);
        this._stagedReload = transaction;

        try {
            await this._PrepareStagedReload(transaction);
            await this._LoadStagedReplacements(transaction);
            transaction.state = "ready";

            return Object.freeze({
                requestedAssetIds: Object.freeze([...requestedIds]),
                affectedAssetIds: Object.freeze(
                    transaction.entries.map((entry) => entry.assetId),
                ),
            });
        } catch (error) {
            await this._AbortStagedReload(transaction, error);
        }
    }

    _CreateReloadTransaction(requestedIds) {
        let resolveCompletion;

        const transaction = {
            state: "staging",
            requestedIds,
            entries: [],
            replacements: [],
            temporaryLeases: [],
            completionPromise: new Promise((resolve) => {
                resolveCompletion = resolve;
            }),
            resolveCompletion: null,
        };

        transaction.resolveCompletion = resolveCompletion;
        return transaction;
    }

    async _PrepareStagedReload(transaction) {
        const pendingLoads = Array.from(
            this._entriesById.values(),
            (entry) => entry,
        )
            .filter((entry) => entry.state === "loading")
            .map((entry) => entry.promise);

        await Promise.allSettled(pendingLoads);

        transaction.entries = this._dependencyResolver.CollectReloadEntries(
            transaction.requestedIds,
            this._entriesById,
        );

        const leaseResults = await Promise.allSettled(
            transaction.entries.map((entry) =>
                this._Acquire(entry.assetId),
            ),
        );

        for (const result of leaseResults) {
            if (result.status === "fulfilled") {
                transaction.temporaryLeases.push(result.value);
            }
        }

        const failedLease = leaseResults.find(
            (result) => result.status === "rejected",
        );

        if (failedLease) {
            throw failedLease.reason;
        }

        transaction.entries.forEach((entry, index) => {
            if (
                transaction.temporaryLeases[index].Handle !==
                entry.handle
            ) {
                throw new Error(
                    `Asset "${entry.assetId}" changed while staging reload.`,
                );
            }
        });
    }

    async _LoadStagedReplacements(transaction) {
        const stagedAssetsById = new Map();

        for (const entry of transaction.entries) {
            await this._LoadStagedReplacement(
                entry,
                stagedAssetsById,
                transaction,
            );
        }
    }

    async _LoadStagedReplacement(entry, stagedAssetsById, transaction) {
        const dependenciesById = this._CreateStagedDependencyMap(
            entry,
            stagedAssetsById,
        );

        const asset = await entry.loader.Load(
            entry.descriptor,
            this._CreateLoaderContext(entry, dependenciesById),
        );

        if (asset === undefined || asset === null) {
            throw new TypeError(
                `Loader returned no replacement for asset "${entry.assetId}".`,
            );
        }

        stagedAssetsById.set(entry.assetId, asset);
        const replacement = {
            entry,
            asset,
            previousAsset: entry.asset,
            memoryToken: null,
            previousMemoryToken: null,
        };
        transaction.replacements.push(replacement);
        replacement.memoryToken = this._TrackAssetMemory(entry, asset);
    }

    _CreateStagedDependencyMap(entry, stagedAssetsById) {
        const dependenciesById = new Map();

        for (const dependencyId of entry.descriptor.dependencies) {
            if (stagedAssetsById.has(dependencyId)) {
                dependenciesById.set(
                    dependencyId,
                    stagedAssetsById.get(dependencyId),
                );
                continue;
            }

            const dependencyEntry = this._entriesById.get(dependencyId);

            if (!dependencyEntry || dependencyEntry.state !== "loaded") {
                throw new Error(
                    `Dependency "${dependencyId}" for asset "${entry.assetId}" is not loaded.`,
                );
            }

            dependenciesById.set(
                dependencyId,
                dependencyEntry.handle.Current,
            );
        }

        return dependenciesById;
    }

    async _AbortStagedReload(transaction, error) {
        const cleanupErrors = await this._CleanupStagedReload(
            transaction,
        );
        transaction.state = "aborted";

        if (this._stagedReload === transaction) {
            this._stagedReload = null;
        }

        transaction.resolveCompletion();

        if (cleanupErrors.length > 0) {
            throw new AggregateError(
                [error, ...cleanupErrors],
                "Asset reload staging failed and cleanup also failed.",
            );
        }

        throw new Error(
            `Failed to stage reload for ${transaction.requestedIds.join(", ")}.`,
            { cause: error },
        );
    }

    CommitStagedReload() {
        const transaction = this._stagedReload;

        if (!transaction || transaction.state === "staging") {
            return null;
        }

        if (transaction.state !== "ready") {
            throw new Error("Asset reload transaction is not ready to commit.");
        }

        for (const replacement of transaction.replacements) {
            if (
                replacement.entry.handle.Current !==
                replacement.previousAsset
            ) {
                throw new Error(
                    `Asset "${replacement.entry.assetId}" changed before reload commit.`,
                );
            }
        }

        for (const replacement of transaction.replacements) {
            replacement.previousAsset = replacement.entry.handle._Replace(
                replacement.asset,
            );
            replacement.previousMemoryToken =
                replacement.entry.memoryToken;
            replacement.entry.asset = replacement.asset;
            replacement.entry.memoryToken = replacement.memoryToken;
            replacement.memoryToken = null;
        }

        transaction.state = "committed";
        this._stagedReload = null;
        transaction.resolveCompletion();

        return this._ReleaseCommittedReload(transaction);
    }

    _CreateLoaderContext(entry, dependenciesById) {
        return Object.freeze({
            GetDependency: (dependencyId) => {
                if (!dependenciesById.has(dependencyId)) {
                    throw new Error(
                        `Asset "${entry.assetId}" does not declare "${dependencyId}" as a dependency.`,
                    );
                }

                return dependenciesById.get(dependencyId);
            },
        });
    }

    async _CleanupStagedReload(transaction) {
        const errors = [];

        for (
            let index = transaction.replacements.length - 1;
            index >= 0;
            index -= 1
        ) {
            const replacement = transaction.replacements[index];
            const { entry, asset } = replacement;

            try {
                if (asset !== entry.asset && entry.loader.Release) {
                    await entry.loader.Release(asset, entry.descriptor);
                }
            } catch (error) {
                errors.push(error);
            } finally {
                this._memoryTracker?.ReleaseResource(
                    replacement.memoryToken,
                );
            }
        }

        const leaseResults = await Promise.allSettled(
            transaction.temporaryLeases.map((lease) => lease.Release()),
        );

        errors.push(
            ...leaseResults
                .filter((result) => result.status === "rejected")
                .map((result) => result.reason),
        );

        transaction.replacements.length = 0;
        transaction.temporaryLeases.length = 0;

        return errors;
    }

    async _ReleaseCommittedReload(transaction) {
        const errors = [];

        for (
            let index = transaction.replacements.length - 1;
            index >= 0;
            index -= 1
        ) {
            const replacement = transaction.replacements[index];

            try {
                if (
                    replacement.previousAsset !== replacement.asset &&
                    replacement.entry.loader.Release
                ) {
                    await replacement.entry.loader.Release(
                        replacement.previousAsset,
                        replacement.entry.descriptor,
                    );
                }
            } catch (error) {
                errors.push(error);
            } finally {
                this._memoryTracker?.ReleaseResource(
                    replacement.previousMemoryToken,
                );
            }
        }

        const leaseResults = await Promise.allSettled(
            transaction.temporaryLeases.map((lease) => lease.Release()),
        );

        errors.push(
            ...leaseResults
                .filter((result) => result.status === "rejected")
                .map((result) => result.reason),
        );

        if (errors.length > 0) {
            throw new AggregateError(
                errors,
                "Asset reload committed, but old assets did not all release cleanly.",
            );
        }

        return Object.freeze({
            assetIds: Object.freeze(
                transaction.replacements.map(
                    ({ entry }) => entry.assetId,
                ),
            ),
        });
    }

    _CreateEntry(assetId) {
        const descriptor = this._assetCatalog.GetRequired(assetId);
        const loader = this._loaderRegistry.GetRequired(
            descriptor.loaderId,
        );

        const entry = {
            assetId,
            descriptor,
            loader,
            handle: new AssetHandle(assetId),
            state: "loading",
            referenceCount: 0,
            asset: undefined,
            memoryToken: null,
            dependencyLeases: [],
            promise: null,
            releasePromise: null,
        };

        this._entriesById.set(assetId, entry);
        this._statesByAssetId.set(assetId, "loading");

        entry.promise = Promise.resolve()
            .then(() => this._LoadEntry(entry))
            .catch((error) => {
                entry.state = "failed";
                this._statesByAssetId.set(assetId, "failed");

                if (this._entriesById.get(assetId) === entry) {
                    this._entriesById.delete(assetId);
                }

                const message = error instanceof Error
                    ? error.message
                    : String(error);
                throw new Error(
                    `Failed to load asset "${assetId}": ${message}`,
                    { cause: error },
                );
            });

        return entry;
    }

    async _LoadEntry(entry) {
        try {
            const dependencyResults = await Promise.allSettled(
                entry.descriptor.dependencies.map((dependencyId) =>
                    this._Acquire(dependencyId),
                ),
            );

            entry.dependencyLeases = dependencyResults
                .filter((result) => result.status === "fulfilled")
                .map((result) => result.value);

            const failedDependency = dependencyResults.find(
                (result) => result.status === "rejected",
            );

            if (failedDependency) {
                throw failedDependency.reason;
            }

            const dependenciesById = new Map();

            entry.descriptor.dependencies.forEach(
                (dependencyId, index) => {
                    dependenciesById.set(
                        dependencyId,
                        entry.dependencyLeases[index].Asset,
                    );
                },
            );

            const asset = await entry.loader.Load(
                entry.descriptor,
                this._CreateLoaderContext(entry, dependenciesById),
            );

            if (asset === undefined || asset === null) {
                throw new TypeError(
                    "Asset loader returned no asset.",
                );
            }

            entry.asset = asset;
            entry.memoryToken = this._TrackAssetMemory(entry, asset);
            entry.handle._Replace(asset);
            entry.state = "loaded";
            this._statesByAssetId.set(entry.assetId, "loaded");

            return asset;
        } catch (error) {
            const cleanupErrors =
                await this._ReleaseDependencyLeases(entry);

            if (cleanupErrors.length > 0) {
                throw new AggregateError(
                    [error, ...cleanupErrors],
                    `Asset "${entry.assetId}" failed to load and dependency cleanup also failed.`,
                );
            }

            throw error;
        }
    }

    async _ReleaseDependencyLeases(entry) {
        const leases = entry.dependencyLeases;
        entry.dependencyLeases = [];

        const results = await Promise.allSettled(
            leases.map((lease) => lease.Release()),
        );

        return results
            .filter((result) => result.status === "rejected")
            .map((result) => result.reason);
    }

    _TrackAssetMemory(entry, asset) {
        const memoryDetails = GetAssetMemoryDetails(asset);

        if (!this._memoryTracker || !memoryDetails) {
            return null;
        }

        return this._memoryTracker.TrackResource({
            label: `Asset ${entry.assetId}`,
            resourceType: memoryDetails.resourceType,
            category: "cpu-asset",
            bytes: memoryDetails.bytes,
            owner: "AssetManager",
            estimated: memoryDetails.estimated,
        });
    }

    _Release(entry) {
        if (entry.state !== "loaded" || entry.referenceCount <= 0) {
            return;
        }

        entry.referenceCount -= 1;

        if (entry.referenceCount > 0) {
            return;
        }

        entry.state = "releasing";
        this._statesByAssetId.set(entry.assetId, "releasing");

        entry.releasePromise = Promise.resolve()
            .then(async () => {
                const errors = [];

                try {
                    if (entry.loader.Release) {
                        await entry.loader.Release(
                            entry.asset,
                            entry.descriptor,
                        );
                    }
                } catch (error) {
                    errors.push(error);
                }

                errors.push(
                    ...(await this._ReleaseDependencyLeases(entry)),
                );

                if (errors.length > 0) {
                    throw new AggregateError(
                        errors,
                        `Failed to release asset "${entry.assetId}".`,
                    );
                }
            })
            .catch((error) => {
                AstralLogger.Error("Asset release failed.", {
                    assetId: entry.assetId,
                    error,
                });

                throw error;
            })
            .finally(() => {
                this._memoryTracker?.ReleaseResource(entry.memoryToken);
                entry.memoryToken = null;
                entry.handle._Clear(entry.asset);
                entry.asset = undefined;
                entry.state = "released";
                this._statesByAssetId.set(
                    entry.assetId,
                    "unloaded",
                );

                if (
                    this._entriesById.get(entry.assetId) === entry
                ) {
                    this._entriesById.delete(entry.assetId);
                }
            });

        return entry.releasePromise;
    }

    _RequireAssetId(assetId) {
        if (typeof assetId !== "string" || assetId.trim() === "") {
            throw new TypeError(
                "Asset ID must be a non-empty string.",
            );
        }
    }
}
