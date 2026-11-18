export function BuildSnapshotComparisonModel(comparison, ownerFilter) {
    const isAllOwners = ownerFilter === "";
    const matchesOwner = (resource) =>
        isAllOwners || resource.owner === ownerFilter;
    const added = comparison.added.filter(matchesOwner);
    const released = comparison.released.filter(matchesOwner);
    const ownerChanges = Object.entries(comparison.ownerChanges)
        .filter(([owner]) => isAllOwners || owner === ownerFilter)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([owner, change]) => ({ owner, ...change }));

    return {
        ownerLabel: isAllOwners ? "All owners" : ownerFilter,
        deltaBytes: isAllOwners
            ? comparison.deltaBytes
            : (comparison.ownerChanges[ownerFilter]?.deltaBytes ?? 0),
        addedBytes: isAllOwners
            ? comparison.addedBytes
            : added.reduce((total, resource) => total + resource.bytes, 0),
        releasedBytes: isAllOwners
            ? comparison.releasedBytes
            : released.reduce((total, resource) => total + resource.bytes, 0),
        ownerChanges,
        added,
        released,
    };
}
