import {
    CreateFrameIndexScale,
    FormatBytes,
} from "../diagnostic-panel-utils.js";

export function MatchesOwnerFilter(owner, resourceOwner, ownerFilter) {
    return (
        ownerFilter === "" ||
        owner === ownerFilter ||
        resourceOwner === ownerFilter
    );
}

export function BuildMemoryFrameChanges(recentFrames, ownerFilter) {
    return recentFrames.map((frame) => {
        const totals = ownerFilter === ""
            ? frame
            : frame.ownerFilterTotals[ownerFilter];

        return {
            frameNumber: frame.frameNumber,
            allocatedBytes: totals?.allocatedBytes ?? 0,
            releasedBytes: totals?.releasedBytes ?? 0,
        };
    });
}

export function BuildMemoryMetrics(usage, frame, ownerFilter) {
    const filteredTotals =
        ownerFilter === "" ? frame : frame?.ownerFilterTotals[ownerFilter];
    const liveBytes =
        ownerFilter === ""
            ? usage.totalBytes
            : usage.bytesByOwner[ownerFilter] ?? 0;
    const liveResourceCount =
        ownerFilter === ""
            ? usage.resourceCount
            : usage.resourceCountByOwner[ownerFilter] ?? 0;
    const metrics = [
        ["Live tracked", FormatBytes(liveBytes)],
        ["Live resources", liveResourceCount],
    ];

    if (!frame) {
        metrics.push(["Frame changes", "No frame captured"]);
        return metrics;
    }

    const allocatedBytes = filteredTotals?.allocatedBytes ?? 0;
    const releasedBytes = filteredTotals?.releasedBytes ?? 0;

    metrics.push(
        ["Frame allocated", FormatBytes(allocatedBytes)],
        ["Frame released", FormatBytes(releasedBytes)],
        [
            "Frame net",
            FormatBytes(
                ownerFilter === ""
                    ? frame.netBytes
                    : allocatedBytes - releasedBytes,
            ),
        ],
        [
            "Dropped events",
            ownerFilter === ""
                ? frame.droppedEventCount
                : filteredTotals?.droppedEventCount ?? 0,
        ],
    );

    return metrics;
}

export function CreateMemoryGraphLayout(frameChanges) {
    const width = 720;
    const height = 220;
    const plotLeft = 58;
    const plotRight = width - 12;
    const plotTop = 12;
    const plotBottom = height - 30;
    const plotWidth = plotRight - plotLeft;
    const plotHeight = plotBottom - plotTop;
    const maxBytes = Math.max(
        1024,
        ...frameChanges.flatMap((frame) => [
            frame.allocatedBytes,
            frame.releasedBytes,
        ]),
    );
    const maxKilobytes = Math.max(1, Math.ceil(maxBytes / 1024));

    return {
        width,
        height,
        plotLeft,
        plotRight,
        maxKilobytes,
        xForIndex: CreateFrameIndexScale(
            frameChanges.length,
            plotLeft,
            plotWidth,
        ),
        yForKilobytes: (kilobytes) =>
            plotTop +
            ((maxKilobytes - kilobytes) / (maxKilobytes * 2)) * plotHeight,
    };
}
