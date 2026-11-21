export class AssetDependencyResolver {
    constructor(assetCatalog) {
        this._assetCatalog = assetCatalog;
        this._validatedAssetIds = new Set();
    }

    Validate(rootAssetId) {
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

    CollectReloadEntries(requestedIds, entriesById) {
        const affectedIds = new Set(requestedIds);

        for (const assetId of requestedIds) {
            const entry = entriesById.get(assetId);
            if (!entry || entry.state !== "loaded") {
                throw new Error(
                    `Asset "${assetId}" must be loaded before it can be reloaded.`,
                );
            }
        }

        let foundDependent;
        do {
            foundDependent = false;

            for (const entry of entriesById.values()) {
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

        return this._OrderReloadEntries(affectedIds, entriesById);
    }

    _OrderReloadEntries(affectedIds, entriesById) {
        const orderedEntries = [];
        const visitedIds = new Set();

        const visit = (entry) => {
            if (visitedIds.has(entry.assetId)) {
                return;
            }

            visitedIds.add(entry.assetId);

            for (const dependencyId of entry.descriptor.dependencies) {
                if (!affectedIds.has(dependencyId)) {
                    continue;
                }

                const dependencyEntry = entriesById.get(dependencyId);
                if (!dependencyEntry || dependencyEntry.state !== "loaded") {
                    throw new Error(
                        `Dependency "${dependencyId}" must be loaded before reload.`,
                    );
                }

                visit(dependencyEntry);
            }

            orderedEntries.push(entry);
        };

        for (const assetId of affectedIds) {
            const entry = entriesById.get(assetId);
            if (!entry || entry.state !== "loaded") {
                throw new Error(
                    `Dependent asset "${assetId}" is not loaded.`,
                );
            }

            visit(entry);
        }

        return orderedEntries;
    }
}
