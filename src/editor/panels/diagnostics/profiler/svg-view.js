import {
    AppendSvgGridLinesAndLabels,
    AppendFrameRangeLabels,
    CreateSvgElement,
} from "../diagnostic-panel-utils.js";

export function FormatMilliseconds(value) {
    return Math.abs(value) < 0.01
        ? `${(value * 1000).toFixed(2)} μs`
        : `${value.toFixed(2)} ms`;
}

export function AppendFrameGraphGrid(
    svg,
    plotLeft,
    plotRight,
    maxDuration,
    yForDuration,
    showBudgetLine,
) {
    AppendSvgGridLinesAndLabels(svg, {
        ticks: [0, maxDuration / 2, maxDuration],
        plotLeft,
        plotRight,
        yForValue: yForDuration,
        formatLabel: (tick) =>
            tick === 0 ? "0 ms" : FormatMilliseconds(tick),
    });

    if (showBudgetLine) {
        const budgetY = yForDuration(16.67);
        svg.append(
            CreateSvgElement("line", {
                x1: plotLeft,
                y1: budgetY,
                x2: plotRight,
                y2: budgetY,
                class: "profiler-chart-budget-line",
            }),
        );
    }
}

export function AppendFrameGraphPoints(
    svg,
    recentFrames,
    selectedFrame,
    xForIndex,
    yForDuration,
    plotLeft,
    plotRight,
    height,
) {
    const points = recentFrames
        .map((frame, index) =>
            `${xForIndex(index)},${yForDuration(frame.durationMs)}`,
        )
        .join(" ");
    svg.append(
        CreateSvgElement("polyline", {
            points,
            class: "profiler-chart-frame-line",
            fill: "none",
        }),
    );

    for (let index = 0; index < recentFrames.length; index += 1) {
        const frame = recentFrames[index];
        const marker = CreateSvgElement("circle", {
            cx: xForIndex(index),
            cy: yForDuration(frame.durationMs),
            r: frame.frameNumber === selectedFrame?.frameNumber ? 4.5 : 2.75,
            class: "profiler-chart-frame-point",
            "data-over-budget": frame.durationMs > 16.67,
            "data-selected": frame.frameNumber === selectedFrame?.frameNumber,
        });
        const markerTitle = CreateSvgElement("title");
        markerTitle.textContent =
            `Frame ${frame.frameNumber}: ` +
            FormatMilliseconds(frame.durationMs);
        marker.append(markerTitle);
        svg.append(marker);
    }

    AppendFrameRangeLabels(
        svg,
        recentFrames[0].frameNumber,
        recentFrames[recentFrames.length - 1].frameNumber,
        plotLeft,
        plotRight,
        height,
    );
}

export function AppendScopeTimelineRows(svg, visibleScopes, layout) {
    const { width, plotTop, rowHeight } = layout;

    for (let index = 0; index < visibleScopes.length; index += 1) {
        svg.append(
            CreateSvgElement("rect", {
                x: 0,
                y: plotTop + index * rowHeight,
                width,
                height: rowHeight,
                class: "profiler-scope-timeline-row",
                "data-alternate": index % 2 === 1,
            }),
        );
    }
}

export function AppendScopeTimelineGrid(svg, layout) {
    const {
        plotLeft,
        plotTop,
        height,
        bottomPadding,
        plotWidth,
        frameDuration,
    } = layout;

    for (const ratio of [0, 0.5, 1]) {
        const x = plotLeft + ratio * plotWidth;
        let textAnchor = "middle";
        if (ratio === 0) {
            textAnchor = "start";
        } else if (ratio === 1) {
            textAnchor = "end";
        }

        const timeLabel = CreateSvgElement("text", {
            x,
            y: 18,
            class: "profiler-chart-label",
            "text-anchor": textAnchor,
        });
        timeLabel.textContent = FormatMilliseconds(frameDuration * ratio);
        svg.append(
            CreateSvgElement("line", {
                x1: x,
                y1: plotTop,
                x2: x,
                y2: height - bottomPadding,
                class: "profiler-scope-timeline-grid-line",
            }),
            timeLabel,
        );
    }
}

export function AppendScopeTimelineBars(svg, visibleScopes, frame, layout) {
    const {
        labelWidth,
        plotLeft,
        plotTop,
        rowHeight,
        plotWidth,
        frameDuration,
    } = layout;

    for (let index = 0; index < visibleScopes.length; index += 1) {
        AppendScopeTimelineBar(
            svg,
            visibleScopes[index],
            index,
            frame,
            labelWidth,
            plotLeft,
            plotTop,
            rowHeight,
            plotWidth,
            frameDuration,
        );
    }
}

function AppendScopeTimelineBar(
    svg,
    visibleScope,
    index,
    frame,
    labelWidth,
    plotLeft,
    plotTop,
    rowHeight,
    plotWidth,
    frameDuration,
) {
    const { scope, depth } = visibleScope;
    const y = plotTop + index * rowHeight;
    const startRatio = Math.max(
        0,
        Math.min(
            1,
            (scope.startTime - frame.startTime) / frameDuration,
        ),
    );
    const endTime = scope.endTime ?? frame.endTime;
    const endRatio = Math.max(
        startRatio,
        Math.min(
            1,
            (endTime - frame.startTime) / frameDuration,
        ),
    );
    const indent = depth * 10;
    const maxLabelLength = Math.max(
        8,
        Math.floor((labelWidth - 20 - indent) / 6),
    );
    const labelText =
        scope.name.length > maxLabelLength
            ? `${scope.name.slice(0, maxLabelLength - 1)}…`
            : scope.name;
    const label = CreateSvgElement("text", {
        x: 8 + indent,
        y: y + 17,
        class: "profiler-scope-timeline-label",
    });
    label.textContent = labelText;
    const bar = CreateSvgElement("rect", {
        x: plotLeft + startRatio * plotWidth,
        y: y + 5,
        width: Math.max(1, (endRatio - startRatio) * plotWidth),
        height: 16,
        rx: 3,
        class: "profiler-scope-timeline-bar",
        "data-category": scope.category,
        "data-incomplete": scope.incomplete,
    });
    const barTitle = CreateSvgElement("title");
    barTitle.textContent =
        `${scope.isAsync ? "Async elapsed · " : "CPU · "}` +
        `${scope.name}: ${FormatMilliseconds(scope.durationMs)}` +
        (scope.incomplete
            ? " (incomplete; duration ends at this frame boundary)"
            : "");
    bar.append(barTitle);
    svg.append(label, bar);
}
