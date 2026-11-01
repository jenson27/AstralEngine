import { AstralLogger } from "../../diagnostics/logger.js";
import { AssetHandle } from "./asset-handle.js";

class AssetLease {
    constructor(handle, release) {
        this._handle = handle;
        this._release = release;
        this._isReleased = false;
    }

    get Asset() {
        if (this._isReleased) {
            throw new Error("Cannot access a released asset lease.");
        }

        return this._handle.Current;
    }

    get Handle() {
        if (this._isReleased) {
            throw new Error("Cannot access a released asset lease.");
        }

        return this._handle;
    }

    Release() {
        if (this._isReleased) {
            return;
        }

        this._isReleased = true;
        const release = this._release;
        this._release = null;

        return release();
    }
}

export class AssetManager {
    constructor(assetCatalog, loaderRegistry) {
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

        this._assetCatalog = assetCatalog;
        this._loaderRegistry = loaderRegistry;
        this._entriesById = new Map();
        this._statesByAssetId = new Map();
        this._validatedAssetIds = new Set();
        this._stagedReload = null;
    }

    async Acquire(assetId) {
        this._RequireAssetId(assetId);

        while (this._stagedReload) {
            await this._stagedReload.completionPromise;
        }

        this._ValidateDependencyGraph(assetId);

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
            this._ValidateDependencyGraph(assetId);
        }

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
        this._stagedReload = transaction;

        try {
            const pendingLoads = Array.from(
                this._entriesById.values(),
                (entry) => entry,
            )
                .filter((entry) => entry.state === "loading")
                .map((entry) => entry.promise);

            await Promise.allSettled(pendingLoads);

            transaction.entries = this._CollectReloadEntries(
                requestedIds,
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

            const stagedAssetsById = new Map();

            for (const entry of transaction.entries) {
                const dependenciesById = new Map();

                for (const dependencyId of entry.descriptor.dependencies) {
                    if (stagedAssetsById.has(dependencyId)) {
                        dependenciesById.set(
                            dependencyId,
                            stagedAssetsById.get(dependencyId),
                        );
                        continue;
                    }

                    const dependencyEntry =
                        this._entriesById.get(dependencyId);

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
                transaction.replacements.push({
                    entry,
                    asset,
                    previousAsset: entry.asset,
                });
            }

            transaction.state = "ready";

            return Object.freeze({
                requestedAssetIds: Object.freeze([...requestedIds]),
                affectedAssetIds: Object.freeze(
                    transaction.entries.map((entry) => entry.assetId),
                ),
            });
        } catch (error) {
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
                `Failed to stage reload for ${requestedIds.join(", ")}.`,
                { cause: error },
            );
        }
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
            replacement.entry.asset = replacement.asset;
        }

        transaction.state = "committed";
        this._stagedReload = null;
        transaction.resolveCompletion();

        return this._ReleaseCommittedReload(transaction);
    }

    _CollectReloadEntries(requestedIds) {
        const affectedIds = new Set(requestedIds);

        for (const assetId of requestedIds) {
            const entry = this._entriesById.get(assetId);

            if (!entry || entry.state !== "loaded") {
                throw new Error(
                    `Asset "${assetId}" must be loaded before it can be reloaded.`,
                );
            }
        }

        let foundDependent;

        do {
            foundDependent = false;

            for (const entry of this._entriesById.values()) {
                if (
                    entry.state !== "loaded" ||
                    affectedIds.has(entry.assetId)
                ) {
                    continue;
                }

                if (
                    entry.descriptor.dependencies.some((dependencyId) =>
                        affectedIds.has(dependencyId),
                    )
                ) {
                    affectedIds.add(entry.assetId);
                    foundDependent = true;
                }
            }
        } while (foundDependent);

        const orderedEntries = [];
        const visitedIds = new Set();

        const visit = (entry) => {
            if (visitedIds.has(entry.assetId)) {
                return;
            }

            visitedIds.add(entry.assetId);

            for (const dependencyId of entry.descriptor.dependencies) {
                if (affectedIds.has(dependencyId)) {
                    const dependencyEntry =
                        this._entriesById.get(dependencyId);

                    if (!dependencyEntry || dependencyEntry.state !== "loaded") {
                        throw new Error(
                            `Dependency "${dependencyId}" must be loaded before reload.`,
                        );
                    }

                    visit(dependencyEntry);
                }
            }

            orderedEntries.push(entry);
        };

        for (const assetId of affectedIds) {
            const entry = this._entriesById.get(assetId);

            if (!entry || entry.state !== "loaded") {
                throw new Error(
                    `Dependent asset "${assetId}" is not loaded.`,
                );
            }

            visit(entry);
        }

        return orderedEntries;
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
            const { entry, asset } = transaction.replacements[index];

            try {
                if (asset !== entry.asset && entry.loader.Release) {
                    await entry.loader.Release(asset, entry.descriptor);
                }
            } catch (error) {
                errors.push(error);
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

                throw new Error(
                    `Failed to load asset "${assetId}".`,
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

    _ValidateDependencyGraph(rootAssetId) {
        const visiting = new Set();
        const path = [];

        const visit = (assetId) => {
            if (visiting.has(assetId)) {
                const cycleStart = path.indexOf(assetId);
                const cycle = [
                    ...path.slice(cycleStart),
                    assetId,
                ];

                throw new Error(
                    "Asset dependency cycle detected: " +
                        cycle.join(" -> "),
                );
            }

            if (this._validatedAssetIds.has(assetId)) {
                return;
            }

            const descriptor =
                this._assetCatalog.GetRequired(assetId);

            visiting.add(assetId);
            path.push(assetId);

            for (const dependencyId of descriptor.dependencies) {
                visit(dependencyId);
            }

            path.pop();
            visiting.delete(assetId);
            this._validatedAssetIds.add(assetId);
        };

        visit(rootAssetId);
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
