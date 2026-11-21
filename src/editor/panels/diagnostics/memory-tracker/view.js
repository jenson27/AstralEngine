import {
    AppendSvgGridLinesAndLabels,
    AppendFrameRangeLabels,
    AppendTableRow,
    CreateDataTable,
    CreateSvgElement,
    FormatBytes,
} from "../diagnostic-panel-utils.js";
import { CreateElement } from "../../../ui/dom-utils.js";
import { BuildSnapshotComparisonModel } from "../snapshot-comparison-model.js";

export function RenderMemoryRows(body, records, getRowValues) {
    const fragment = document.createDocumentFragment();

    for (const record of records) {
        AppendTableRow(fragment, getRowValues(record));
    }

    body.replaceChildren(fragment);
}

export function AppendMemoryGraphGrid(
    svg,
    plotLeft,
    plotRight,
    maxKilobytes,
    yForKilobytes,
) {
    AppendSvgGridLinesAndLabels(svg, {
        ticks: [maxKilobytes, 0, -maxKilobytes],
        plotLeft,
        plotRight,
        yForValue: yForKilobytes,
        formatLabel: (tick) =>
            tick > 0 ? `+${tick} KB` : tick < 0 ? `${tick} KB` : "0",
        lineClassForTick: (tick) =>
            tick === 0
                ? "profiler-chart-zero-line"
                : "profiler-chart-grid-line",
    });
}

export function AppendMemoryGraphSeries(
    svg,
    frameChanges,
    selectedFrameNumber,
    xForIndex,
    yForKilobytes,
    plotLeft,
    plotRight,
    height,
) {
    const series = [
        {
            key: "allocatedBytes",
            sign: 1,
            className: "profiler-chart-memory-allocated",
            label: "allocated",
        },
        {
            key: "releasedBytes",
            sign: -1,
            className: "profiler-chart-memory-released",
            label: "released",
        },
    ];

    for (const { key, sign, className, label } of series) {
        const values = frameChanges.map(
            (frame) => (frame[key] / 1024) * sign,
        );
        const points = values
            .map(
                (value, index) =>
                    `${xForIndex(index)},${yForKilobytes(value)}`,
            )
            .join(" ");
        svg.append(
            CreateSvgElement("polyline", {
                points,
                class: className,
                fill: "none",
            }),
        );

        for (let index = 0; index < frameChanges.length; index += 1) {
            const frame = frameChanges[index];
            const marker = CreateSvgElement("circle", {
                cx: xForIndex(index),
                cy: yForKilobytes(values[index]),
                r: frame.frameNumber === selectedFrameNumber ? 3.75 : 2.25,
                class: `${className}-point`,
                "data-selected": frame.frameNumber === selectedFrameNumber,
            });
            const markerTitle = CreateSvgElement("title");
            markerTitle.textContent =
                `Frame ${frame.frameNumber}: ` +
                `${FormatBytes(frame[key])} ${label}`;
            marker.append(markerTitle);
            svg.append(marker);
        }
    }

    AppendFrameRangeLabels(
        svg,
        frameChanges[0].frameNumber,
        frameChanges[frameChanges.length - 1].frameNumber,
        plotLeft,
        plotRight,
        height,
    );
}

function BuildOwnerChangesTable(ownerChanges) {
    const { table, body } = CreateDataTable([
        "Owner",
        "Base",
        "Compare",
        "Change",
    ]);

    for (const change of ownerChanges) {
        const delta = change.deltaBytes;
        AppendTableRow(body, [
            change.owner,
            FormatBytes(change.beforeBytes),
            FormatBytes(change.afterBytes),
            `${delta > 0 ? "+" : delta < 0 ? "-" : ""}${FormatBytes(Math.abs(delta))}`,
        ]);
    }

    return table;
}

function BuildResourceChangesTable(added, released) {
    const { table, body } = CreateDataTable([
        "Resource",
        "Change",
        "Owner",
        "Bytes",
    ]);

    AppendResourceChangeRows(body, added, "Added");
    AppendResourceChangeRows(body, released, "Released");

    return table;
}

function AppendResourceChangeRows(body, resources, changeLabel) {
    for (const resource of resources) {
        AppendTableRow(body, [
            resource.label,
            changeLabel,
            resource.owner,
            FormatBytes(resource.bytes),
        ]);
    }
}

export function CreateBrowserMemorySummary(sample) {
    const total = CreateElement("p");
    total.textContent =
        `Page-wide browser estimate: ${FormatBytes(sample.bytes)}. ` +
        "This value is not assigned to a system.";
    return total;
}

export function BuildBrowserMemoryBreakdownContent(breakdown) {
    if (breakdown.length === 0) {
        const empty = CreateElement("p", "profiler-muted");
        empty.textContent = "No breakdown entries were returned.";
        return empty;
    }

    const details = CreateElement("details");
    const summary = CreateElement("summary");
    summary.textContent = `Breakdown (${breakdown.length})`;

    const { table, body } = CreateDataTable([
        "Bytes",
        "Attribution",
        "Types",
    ]);

    for (const item of breakdown) {
        AppendTableRow(body, [
            FormatBytes(item.bytes),
            item.attribution ?? "Unknown",
            Array.isArray(item.types) ? item.types.join(", ") : "",
        ]);
    }

    const tableWrap = CreateElement("div", "profiler-table-wrap");
    tableWrap.append(table);
    details.append(summary, tableWrap);
    return details;
}

export function BuildSnapshotComparisonContent(comparison, ownerFilter) {
    const model = BuildSnapshotComparisonModel(comparison, ownerFilter);
    const summary = CreateElement("p");
    summary.textContent =
        `${model.ownerLabel}: Net change: ${FormatBytes(model.deltaBytes)}; ` +
        `${FormatBytes(model.addedBytes)} added; ` +
        `${FormatBytes(model.releasedBytes)} released.`;

    return [
        summary,
        BuildOwnerChangesTable(model.ownerChanges),
        BuildResourceChangesTable(model.added, model.released),
    ];
}
