import { CreateFrameIndexScale } from "../diagnostic-panel-utils.js";

export function CreateFrameGraphLayout(recentFrames, scale) {
    const width = 720;
    const height = 220;
    const plotLeft = 52;
    const plotRight = width - 12;
    const plotTop = 12;
    const plotBottom = height - 30;
    const plotWidth = plotRight - plotLeft;
    const plotHeight = plotBottom - plotTop;
    const observedMaxDuration = Math.max(
        ...recentFrames.map((frame) => frame.durationMs),
    );
    const budgetMaxDuration = Math.max(
        20,
        Math.ceil(observedMaxDuration / 5) * 5,
    );
    const maxDuration =
        scale === "budget"
            ? budgetMaxDuration
            : Math.max(0.05, observedMaxDuration * 1.15);
    const showBudgetLine = maxDuration >= 16.67;

    return {
        width,
        height,
        plotLeft,
        plotRight,
        maxDuration,
        showBudgetLine,
        xForIndex: CreateFrameIndexScale(
            recentFrames.length,
            plotLeft,
            plotWidth,
        ),
        yForDuration: (durationMs) =>
            plotBottom - (durationMs / maxDuration) * plotHeight,
        graphDescription: showBudgetLine
            ? "CPU frame time across recent frames. The orange line marks the 16.67 millisecond target."
            : "CPU frame time across recent frames, auto-scaled to recent frame timings.",
        caption: showBudgetLine
            ? "The target line marks 16.67 ms for 60 FPS."
            : "Auto scale focuses on recent frame times. The 16.67 ms target is above this range.",
    };
}

export function BuildSystemTimes(frame) {
    const systemTimes = new Map();

    for (const scope of frame.scopes) {
        if (scope.category !== "system" || scope.isAsync) {
            continue;
        }

        const systemTime = systemTimes.get(scope.name) ?? 0;
        systemTimes.set(scope.name, systemTime + scope.durationMs);
    }

    return [...systemTimes].sort((left, right) => right[1] - left[1]);
}

export function BuildChildDurationByParent(scopes) {
    const childDurationByParent = new Map();

    for (const scope of scopes) {
        if (scope.parentScopeIndex === null) {
            continue;
        }

        childDurationByParent.set(
            scope.parentScopeIndex,
            (childDurationByParent.get(scope.parentScopeIndex) ?? 0) +
                scope.durationMs,
        );
    }

    return childDurationByParent;
}

export function GetScopeDepth(scopes, scopeIndex, selectedSystem) {
    let parentIndex = scopeIndex;
    let depth = 0;
    let withinSelectedSystem = selectedSystem === "";

    while (parentIndex !== null) {
        const parentScope = scopes[parentIndex];

        if (
            parentScope.category === "system" &&
            parentScope.name === selectedSystem
        ) {
            withinSelectedSystem = true;
        }

        parentIndex = parentScope.parentScopeIndex;

        if (parentIndex !== null) {
            depth += 1;
        }
    }

    return withinSelectedSystem ? depth : -1;
}

export function CreateScopeTimelineLayout(frame, visibleScopes) {
    const width = 720;
    const labelWidth = 236;
    const plotLeft = labelWidth;
    const plotRight = width - 12;
    const plotWidth = plotRight - plotLeft;
    const plotTop = 30;
    const rowHeight = 26;
    const bottomPadding = 8;
    const height = plotTop + visibleScopes.length * rowHeight + bottomPadding;
    const frameDuration = Math.max(frame.durationMs, 0.001);

    return {
        width,
        labelWidth,
        plotLeft,
        plotWidth,
        plotTop,
        rowHeight,
        bottomPadding,
        height,
        frameDuration,
    };
}
