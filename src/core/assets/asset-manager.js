import { AstralLogger } from "../../diagnostics/logger.js";

class AssetLease {
    constructor(asset, release) {
        this._asset = asset;
        this._release = release;
        this._isReleased = false;
    }

    get Asset() {
        if (this._isReleased) {
            throw new Error("Cannot access a released asset lease.");
        }

        return this._asset;
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
    }

    async Acquire(assetId) {
        this._RequireAssetId(assetId);
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
                const asset = await entry.promise;

                return new AssetLease(asset, () =>
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

    _CreateEntry(assetId) {
        const descriptor = this._assetCatalog.GetRequired(assetId);
        const loader = this._loaderRegistry.GetRequired(
            descriptor.loaderId,
        );

        const entry = {
            assetId,
            descriptor,
            loader,
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

            const loaderContext = Object.freeze({
                GetDependency: (dependencyId) => {
                    if (!dependenciesById.has(dependencyId)) {
                        throw new Error(
                            `Asset "${entry.assetId}" does not declare "${dependencyId}" as a dependency.`,
                        );
                    }

                    return dependenciesById.get(dependencyId);
                },
            });

            const asset = await entry.loader.Load(
                entry.descriptor,
                loaderContext,
            );

            if (asset === undefined || asset === null) {
                throw new TypeError(
                    "Asset loader returned no asset.",
                );
            }

            entry.asset = asset;
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
