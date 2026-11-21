import {
    AppendSvgText,
    AppendTableCells,
    AppendTableRow,
    BuildFilterOptions,
    CreateEmptyMessage,
    CreateSvgElement,
    RefreshFrameSelection,
    RenderStatCards,
    SetOptions,
} from "../diagnostic-panel-utils.js";
import { CreateElement } from "../../../ui/dom-utils.js";
import {
    BuildChildDurationByParent,
    BuildSystemTimes,
    CreateFrameGraphLayout,
    CreateScopeTimelineLayout,
    GetScopeDepth,
} from "./model.js";
import {
    AppendFrameGraphGrid,
    AppendFrameGraphPoints,
    AppendScopeTimelineBars,
    AppendScopeTimelineGrid,
    AppendScopeTimelineRows,
    FormatMilliseconds,
} from "./svg-view.js";

const REFRESH_INTERVAL_MS = 1000;
const MAX_RECENT_FRAMES = 120;
const MAX_TIMELINE_SCOPES = 250;
const MAX_SCOPE_ROWS = 500;

export class ProfilerPanel {
    constructor(profiler, panelElement, renderer = null) {
        if (
            !profiler ||
            typeof profiler.GetFrames !== "function" ||
            typeof profiler.GetAsyncSpans !== "function" ||
            !Number.isSafeInteger(profiler.DroppedAsyncSpanCount)
        ) {
            throw new TypeError("ProfilerPanel requires a profiler.");
        }

        if (!(panelElement instanceof HTMLElement)) {
            throw new TypeError("ProfilerPanel requires a panel element.");
        }

        this._profiler = profiler;
        this._renderer = renderer;
        this._root = panelElement;
        this._root.classList.add("diagnostic-panel", "profiler-panel");
        this._refreshTimer = null;
        this._selectedFrameNumber = null;
        this._frameGraphScale = "auto";
        this._systemFilter = "";
        this._scopeFilter = "";
        this._lastRevision = -1;

        this._root.innerHTML = `
            <div class="profiler-toolbar profiler-capture-toolbar">
                <span class="profiler-muted">Capture format version 1 · CPU timing is always available · <span data-role="gpu-timing-status"></span></span>
                <button type="button" data-action="capture"></button>
            </div>
            <section class="profiler-section">
                <h3>Performance</h3>
                <div
                    class="profiler-section-body profiler-stat-grid profiler-performance-cards"
                    data-role="performance-strip"
                    role="group"
                    aria-label="Frame performance"
                ></div>
            </section>
            <section class="profiler-view">
                <p class="profiler-muted">Synchronous scopes show CPU time. Async spans show elapsed time across frames, including waits. System totals include all fixed update steps in the selected frame.</p>
                <div class="profiler-toolbar">
                    <label>Frame <select data-role="frame-select"></select></label>
                    <label>System <select data-role="system-filter"></select></label>
                    <label>Scope <input data-role="scope-filter" type="search" placeholder="Filter names" /></label>
                </div>
                <section class="profiler-section">
                    <h3>CPU frame time</h3>
                    <div class="profiler-toolbar profiler-frame-graph-toolbar">
                        <label>Scale <select data-role="frame-graph-scale"><option value="auto">Auto</option><option value="budget">Budget</option></select></label>
                        <p class="profiler-muted profiler-chart-caption" data-role="frame-graph-caption"></p>
                    </div>
                    <div class="profiler-section-body profiler-frame-graph" data-role="frame-graph"></div>
                </section>
                <section class="profiler-section">
                    <h3>System CPU time</h3>
                    <div class="profiler-section-body profiler-system-chart" data-role="system-time-graph"></div>
                </section>
                <section class="profiler-section">
                    <h3>CPU scope timeline</h3>
                    <p class="profiler-muted profiler-chart-caption" data-role="scope-timeline-count">Bars show each scope's start time and duration within the selected frame.</p>
                    <div class="profiler-section-body profiler-scope-timeline" data-role="scope-timeline"></div>
                </section>
                <section class="profiler-section">
                    <h3>Frame analysis</h3>
                    <div class="profiler-section-body profiler-stat-grid" data-role="frame-analysis"></div>
                </section>
                <section class="profiler-section">
                    <h3>CPU scopes <span data-role="scope-count"></span></h3>
                    <div class="profiler-table-wrap">
                        <table class="profiler-table">
                            <thead><tr><th>Scope</th><th>Kind</th><th>Status</th><th>Total</th><th>Self</th></tr></thead>
                            <tbody data-role="scope-rows"></tbody>
                        </table>
                    </div>
                    <div class="profiler-empty" data-role="scope-empty" hidden>No captured scopes. Start capture to record frame timings.</div>
                </section>
                <section class="profiler-section">
                    <h3>Async operation spans <span data-role="async-span-count"></span></h3>
                    <p class="profiler-muted profiler-chart-caption">Elapsed time can include waits. Frame numbers show where each operation started and completed.</p>
                    <div class="profiler-table-wrap">
                        <table class="profiler-table">
                            <thead><tr><th>Operation</th><th>Category</th><th>Frames</th><th>Status</th><th>Elapsed</th></tr></thead>
                            <tbody data-role="async-span-rows"></tbody>
                        </table>
                    </div>
                    <div class="profiler-empty" data-role="async-span-empty" hidden>No async spans were captured.</div>
                </section>
            </section>
        `;

        this._onClick = this._HandleClick.bind(this);
        this._onChange = this._HandleChange.bind(this);
        this._onInput = this._HandleInput.bind(this);

        this._root.addEventListener("click", this._onClick);
        this._root.addEventListener("change", this._onChange);
        this._root.addEventListener("input", this._onInput);
        this._UpdateCaptureButton();
        this._UpdateGpuTimingStatus();
        this._Refresh(true);
    }

    OnShow() {
        if (this._refreshTimer !== null) {
            return;
        }

        this._Refresh(true);
        this._refreshTimer = globalThis.setInterval(
            () => this._Refresh(),
            REFRESH_INTERVAL_MS,
        );
    }

    OnHide() {
        if (this._refreshTimer === null) {
            return;
        }

        globalThis.clearInterval(this._refreshTimer);
        this._refreshTimer = null;
    }

    Dispose() {
        this.OnHide();
        this._root.removeEventListener("click", this._onClick);
        this._root.removeEventListener("change", this._onChange);
        this._root.removeEventListener("input", this._onInput);
    }

    _HandleClick(event) {
        const button = event.target.closest("button");

        if (!button || !this._root.contains(button)) {
            return;
        }

        if (button.dataset.action === "capture") {
            this._profiler.SetEnabled(!this._profiler.IsEnabled);
            this._UpdateCaptureButton();
            this._RefreshFrames();
        }
    }

    _HandleChange(event) {
        const role = event.target.dataset.role;

        if (role === "frame-select") {
            this._selectedFrameNumber = Number(event.target.value);
            this._RefreshFrames();
        } else if (role === "system-filter") {
            this._systemFilter = event.target.value;
            this._RefreshFrames();
        } else if (role === "frame-graph-scale") {
            this._frameGraphScale = event.target.value;
            this._RefreshFrames();
        }
    }

    _HandleInput(event) {
        if (event.target.dataset.role === "scope-filter") {
            this._scopeFilter = event.target.value.trim().toLowerCase();
            this._RefreshFrames();
        }
    }

    _UpdateCaptureButton() {
        const button = this._root.querySelector('[data-action="capture"]');
        button.textContent = this._profiler.IsEnabled
            ? "Pause capture"
            : "Start capture";
    }

    _Refresh(force = false) {
        if (this._root.hidden) {
            return;
        }

        const gpuStatusChanged = this._UpdateGpuTimingStatus();
        const asyncSpans = this._profiler.GetAsyncSpans();
        const hasRunningAsyncSpans = asyncSpans.some(
            (span) => span.status === "running",
        );

        const profilerRevisionChanged =
            this._lastRevision !== this._profiler.Revision;

        if (!force && !gpuStatusChanged && !profilerRevisionChanged) {
            if (hasRunningAsyncSpans) {
                this._RenderAsyncSpans(asyncSpans);
            }

            return;
        }

        this._UpdateCaptureButton();
        this._RefreshFrames(asyncSpans);
    }

    _UpdateGpuTimingStatus() {
        const status = this._root.querySelector(
            '[data-role="gpu-timing-status"]',
        );
        const nextText = this._renderer?.GpuTimingSupported
            ? "GPU timestamps available"
            : "GPU timestamps unavailable";
        const didChange = status.textContent !== nextText;

        status.textContent = nextText;
        return didChange;
    }

    _RefreshFrames(asyncSpans = this._profiler.GetAsyncSpans()) {
        const frames = this._profiler.GetFrames();
        this._RefreshSystemFilter(frames);
        const selectedFrame = RefreshFrameSelection(
            this._root.querySelector('[data-role="frame-select"]'),
            frames,
            this._selectedFrameNumber,
            (frameNumber) => {
                this._selectedFrameNumber = frameNumber;
                this._Refresh(true);
            },
        );
        this._selectedFrameNumber = selectedFrame?.frameNumber ?? null;
        const recentFrames = frames.slice(-MAX_RECENT_FRAMES);

        const visibleScopes = selectedFrame
            ? this._BuildVisibleScopes(selectedFrame)
            : [];
        const timelineScopes = visibleScopes.slice(0, MAX_TIMELINE_SCOPES);
        const tableScopes = visibleScopes.slice(0, MAX_SCOPE_ROWS);

        this._RenderFrameGraph(recentFrames, selectedFrame);
        this._RenderSystemTimeGraph(selectedFrame);
        this._RenderScopeTimeline(
            selectedFrame,
            timelineScopes,
            visibleScopes.length,
        );
        this._RenderFrameAnalysis(recentFrames, selectedFrame);
        this._RenderScopes(selectedFrame, tableScopes, visibleScopes.length);
        this._RenderAsyncSpans(asyncSpans);
        this._lastRevision = this._profiler.Revision;
    }

    _RefreshSystemFilter(frames) {
        const systemSelect = this._root.querySelector(
            '[data-role="system-filter"]',
        );
        const systemNames = new Set();

        for (const frame of frames) {
            for (const scope of frame.scopes) {
                if (scope.category === "system" && !scope.isAsync) {
                    systemNames.add(scope.name);
                }
            }
        }

        this._systemFilter = SetOptions(
            systemSelect,
            BuildFilterOptions(systemNames, "All systems"),
            this._systemFilter,
            (value) => {
                this._systemFilter = value;
                this._Refresh(true);
            },
        );
    }

    _RenderFrameGraph(recentFrames, selectedFrame) {
        const graph = this._root.querySelector('[data-role="frame-graph"]');
        if (recentFrames.length === 0) {
            graph.replaceChildren(
                CreateEmptyMessage("Start capture to collect frame timings."),
            );
            return;
        }

        const layout = CreateFrameGraphLayout(
            recentFrames,
            this._frameGraphScale,
        );
        this._root.querySelector(
            '[data-role="frame-graph-caption"]',
        ).textContent = layout.caption;
        const svg = CreateSvgElement("svg", {
            class: "profiler-svg-chart",
            viewBox: `0 0 ${layout.width} ${layout.height}`,
            role: "img",
            "aria-label": layout.graphDescription,
        });
        const title = CreateSvgElement("title");
        title.textContent = layout.graphDescription;
        svg.append(title);

        AppendFrameGraphGrid(
            svg,
            layout.plotLeft,
            layout.plotRight,
            layout.maxDuration,
            layout.yForDuration,
            layout.showBudgetLine,
        );
        AppendFrameGraphPoints(
            svg,
            recentFrames,
            selectedFrame,
            layout.xForIndex,
            layout.yForDuration,
            layout.plotLeft,
            layout.plotRight,
            layout.height,
        );
        graph.replaceChildren(svg);
    }

    _RenderSystemTimeGraph(frame) {
        const graph = this._root.querySelector(
            '[data-role="system-time-graph"]',
        );
        graph.setAttribute("role", "list");
        graph.setAttribute(
            "aria-label",
            frame
                ? `System CPU time for frame ${frame.frameNumber}`
                : "System CPU time",
        );

        if (!frame) {
            graph.replaceChildren(
                CreateEmptyMessage("Start capture to collect system timings."),
            );
            return;
        }

        const sortedSystems = BuildSystemTimes(frame);

        if (sortedSystems.length === 0) {
            graph.replaceChildren(
                CreateEmptyMessage("No system scopes were captured for this frame."),
            );
            return;
        }

        const maxDuration = Math.max(
            0.001,
            ...sortedSystems.map(([, value]) => value),
        );
        const fragment = document.createDocumentFragment();

        for (const [name, durationMs] of sortedSystems) {
            const row = CreateElement("div", "profiler-system-row");
            row.setAttribute("role", "listitem");
            row.setAttribute(
                "aria-label",
                `${name}: ${FormatMilliseconds(durationMs)}`,
            );

            const label = CreateElement("span", "profiler-system-name");
            label.textContent = name;

            const track = CreateElement("span", "profiler-system-track");
            track.setAttribute("aria-hidden", "true");
            const bar = CreateElement("span", "profiler-system-bar");
            bar.style.width = `${(durationMs / maxDuration) * 100}%`;
            track.append(bar);

            const value = CreateElement("strong", "profiler-system-value");
            value.textContent = FormatMilliseconds(durationMs);
            row.append(label, track, value);
            fragment.append(row);
        }

        const axis = CreateElement("div", "profiler-system-axis");
        const zeroLabel = CreateElement("span");
        const maxLabel = CreateElement("span");
        zeroLabel.textContent = "0 ms";
        maxLabel.textContent = FormatMilliseconds(maxDuration);
        axis.append(zeroLabel, maxLabel);
        fragment.append(axis);
        graph.replaceChildren(fragment);
    }

    _RenderScopeTimeline(frame, visibleScopes, totalVisibleScopes) {
        const timeline = this._root.querySelector(
            '[data-role="scope-timeline"]',
        );
        const count = this._root.querySelector(
            '[data-role="scope-timeline-count"]',
        );

        if (!frame) {
            count.textContent = "No captured scopes.";
            timeline.replaceChildren(
                CreateEmptyMessage("Start capture to collect scope timings."),
            );
            return;
        }

        if (visibleScopes.length === 0) {
            count.textContent = "0 matching scopes.";
            timeline.replaceChildren(
                CreateEmptyMessage("No scopes match the current filters."),
            );
            return;
        }

        count.textContent =
            totalVisibleScopes > visibleScopes.length
                ? `Showing ${visibleScopes.length} of ${totalVisibleScopes} matching scopes.`
                : `${totalVisibleScopes} matching scopes.`;

        const timelineLayout = CreateScopeTimelineLayout(frame, visibleScopes);
        const svg = CreateSvgElement("svg", {
            class: "profiler-svg-chart profiler-scope-timeline-svg",
            viewBox: `0 0 ${timelineLayout.width} ${timelineLayout.height}`,
            role: "img",
            "aria-label": `CPU scopes for frame ${frame.frameNumber}`,
        });
        const title = CreateSvgElement("title");
        title.textContent = `CPU scopes for frame ${frame.frameNumber}`;
        svg.append(title);

        AppendScopeTimelineRows(svg, visibleScopes, timelineLayout);
        AppendScopeTimelineGrid(svg, timelineLayout);
        AppendScopeTimelineBars(svg, visibleScopes, frame, timelineLayout);

        timeline.replaceChildren(svg);
    }

    _RenderFrameAnalysis(recentFrames, selectedFrame) {
        this._RenderPerformanceStrip(recentFrames, selectedFrame);
        const analysis = this._root.querySelector(
            '[data-role="frame-analysis"]',
        );

        if (!selectedFrame) {
            analysis.replaceChildren();
            analysis.append(CreateEmptyMessage("Start capture to collect frame data."));
            return;
        }

        const recentDurations = recentFrames
            .map((frame) => frame.durationMs)
            .sort((left, right) => left - right);
        const averageDuration =
            recentDurations.reduce((total, duration) => total + duration, 0) /
            recentDurations.length;
        const p95Duration =
            recentDurations[
                Math.max(0, Math.ceil(recentDurations.length * 0.95) - 1)
            ];
        const metrics = selectedFrame.metrics;

        const stats = [
            ["CPU frame", FormatMilliseconds(selectedFrame.durationMs)],
            ["GPU frame", this._FormatGpuFrameTime(selectedFrame)],
            ["Recent average", FormatMilliseconds(averageDuration)],
            ["Recent P95", FormatMilliseconds(p95Duration)],
            ["Frame delta", FormatMilliseconds(metrics["frame.deltaMs"] ?? 0)],
            ["Fixed steps", metrics["simulation.fixedSteps"] ?? 0],
            ["Dropped simulation", FormatMilliseconds(metrics["simulation.droppedTimeMs"] ?? 0)],
            ["Interpolation", (metrics["render.interpolationAlpha"] ?? 0).toFixed(3)],
            ["Dropped scopes", selectedFrame.droppedScopeCount],
        ];

        RenderStatCards(analysis, stats);
    }

    _RenderAsyncSpans(spans = this._profiler.GetAsyncSpans()) {
        const body = this._root.querySelector(
            '[data-role="async-span-rows"]',
        );
        const empty = this._root.querySelector(
            '[data-role="async-span-empty"]',
        );
        const count = this._root.querySelector(
            '[data-role="async-span-count"]',
        );

        if (!body || !empty || !count) {
            return;
        }

        const fragment = document.createDocumentFragment();

        for (const span of spans) {
            const endFrame =
                span.endFrameNumber === null
                    ? "…"
                    : String(span.endFrameNumber);
            const row = CreateElement("tr");
            row.className = span.status === "incomplete" ? "profiler-warning" : "";

            AppendTableCells(row, [
                span.name,
                span.category,
                `Frame ${span.startFrameNumber} → ${endFrame}`,
                span.status,
                FormatMilliseconds(span.durationMs),
            ]);

            fragment.append(row);
        }

        body.replaceChildren(fragment);
        count.textContent =
            spans.length === 0 && this._profiler.DroppedAsyncSpanCount === 0
                ? ""
                : `· ${spans.length} captured · ${this._profiler.DroppedAsyncSpanCount} dropped`;
        empty.hidden =
            spans.length !== 0 || this._profiler.DroppedAsyncSpanCount !== 0;
        empty.textContent =
            this._profiler.DroppedAsyncSpanCount === 0
                ? "No async spans were captured."
                : "No spans are retained. New spans reached the active span limit.";
    }

    _RenderPerformanceStrip(recentFrames, selectedFrame) {
        const frameTimeMs = selectedFrame?.metrics["frame.deltaMs"];
        const recentFrameTimes = recentFrames
            .map((frame) => frame.metrics["frame.deltaMs"])
            .filter((value) => Number.isFinite(value) && value >= 0);
        const averageFrameTimeMs = recentFrameTimes.length
            ? recentFrameTimes.reduce((total, value) => total + value, 0) /
              recentFrameTimes.length
            : null;
        const fps =
            Number.isFinite(frameTimeMs) && frameTimeMs > 0
                ? 1000 / frameTimeMs
                : null;

        const stats = [
            ["FPS", fps === null ? "—" : `${fps.toFixed(1)} FPS`],
            [
                "Frame time",
                Number.isFinite(frameTimeMs)
                    ? FormatMilliseconds(frameTimeMs)
                    : "—",
            ],
            [
                "Average frame time",
                averageFrameTimeMs === null
                    ? "—"
                    : FormatMilliseconds(averageFrameTimeMs),
            ],
        ];
        RenderStatCards(
            this._root.querySelector('[data-role="performance-strip"]'),
            stats,
        );
    }

    _FormatGpuFrameTime(frame) {
        if (!this._renderer?.GpuTimingSupported) {
            return "Unavailable";
        }

        const durationMs = this._profiler.GetGpuFrameTime(frame.frameNumber);
        return durationMs === null
            ? "Waiting for sample"
            : FormatMilliseconds(durationMs);
    }

    _BuildVisibleScopes(frame) {
        const scopes = frame.scopes;
        const childDurationByParent =
            BuildChildDurationByParent(scopes);
        const visibleScopes = [];

        for (let index = 0; index < scopes.length; index += 1) {
            const scope = scopes[index];

            if (scope.isAsync) {
                continue;
            }

            const depth = GetScopeDepth(
                scopes,
                index,
                this._systemFilter,
            );

            if (depth < 0) {
                continue;
            }

            if (
                this._scopeFilter !== "" &&
                !scope.name.toLowerCase().includes(this._scopeFilter)
            ) {
                continue;
            }

            visibleScopes.push({
                scope,
                depth,
                selfTime: Math.max(
                    0,
                    scope.durationMs -
                        (childDurationByParent.get(index) ?? 0),
                ),
            });
        }

        return visibleScopes;
    }

    _RenderScopes(frame, visibleScopes, totalVisibleScopes) {
        const body = this._root.querySelector('[data-role="scope-rows"]');
        const empty = this._root.querySelector('[data-role="scope-empty"]');
        const count = this._root.querySelector('[data-role="scope-count"]');

        if (!frame) {
            body.replaceChildren();
            count.textContent = "";
            empty.hidden = false;
            return;
        }

        const fragment = document.createDocumentFragment();

        for (const { scope, depth, selfTime } of visibleScopes) {
            const row = CreateElement(
                "tr",
                scope.incomplete ? "profiler-warning" : "",
            );
            const nameCell = CreateElement("td", "profiler-scope-name");
            nameCell.style.paddingInlineStart = `${0.45 + depth * 1.1}rem`;
            nameCell.textContent = scope.name;
            row.append(nameCell);

            AppendTableCells(row, [
                scope.isAsync ? "Async elapsed" : scope.category,
                scope.incomplete ? "Partial (frame ended)" : "Complete",
                FormatMilliseconds(scope.durationMs),
                selfTime === null ? "—" : FormatMilliseconds(selfTime),
            ]);

            fragment.append(row);
        }

        body.replaceChildren(fragment);
        empty.hidden = visibleScopes.length !== 0;
        count.textContent =
            totalVisibleScopes > visibleScopes.length
                ? `Showing ${visibleScopes.length} of ${totalVisibleScopes}`
                : `${totalVisibleScopes}`;
    }

}
