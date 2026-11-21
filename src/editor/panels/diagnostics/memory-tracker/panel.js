import {
    BuildFilterOptions,
    CreateEmptyMessage,
    CreateSvgElement,
    FormatBytes,
    RefreshFrameSelection,
    RenderStatCards,
    SetOptions,
} from "../diagnostic-panel-utils.js";
import {
    BuildMemoryFrameChanges,
    BuildMemoryMetrics,
    CreateMemoryGraphLayout,
    MatchesOwnerFilter,
} from "./model.js";
import {
    AppendMemoryGraphGrid,
    AppendMemoryGraphSeries,
    BuildBrowserMemoryBreakdownContent,
    BuildSnapshotComparisonContent,
    CreateBrowserMemorySummary,
    RenderMemoryRows,
} from "./view.js";

const REFRESH_INTERVAL_MS = 1000;

export class MemoryTrackerPanel {
    constructor(memoryTracker, panelElement) {
        if (!memoryTracker || typeof memoryTracker.GetFrames !== "function") {
            throw new TypeError("MemoryTrackerPanel requires a memory tracker.");
        }

        if (!(panelElement instanceof HTMLElement)) {
            throw new TypeError("MemoryTrackerPanel requires a panel element.");
        }

        this._memoryTracker = memoryTracker;
        this._root = panelElement;
        this._root.classList.add("diagnostic-panel", "memory-tracker-panel");
        this._refreshTimer = null;
        this._selectedFrameNumber = null;
        this._ownerFilter = "";
        this._browserMemorySample = null;
        this._lastRevision = -1;
        this._lastLiveResourceRevision = -1;
        this._lastLiveResourceFilter = null;
        this._root.innerHTML = `
            <div class="profiler-toolbar profiler-capture-toolbar">
                <span class="profiler-muted">Memory tracking · Version 1</span>
            </div>
            <p class="profiler-muted">Tracked resources are engine-owned estimates. Browser heap samples are page-wide and cannot be assigned to a system.</p>
            <div class="profiler-memory-actions">
                <button type="button" data-action="snapshot">Capture snapshot</button>
                <button type="button" data-action="browser-memory">Sample browser memory</button>
                <label>Memory frame <select data-role="memory-frame"></select></label>
                <label>Owner <select data-role="memory-owner-filter"></select></label>
            </div>
            <section class="profiler-section">
                <h3>Memory changes by frame</h3>
                <p class="profiler-muted profiler-chart-caption">Allocations rise above zero. Releases fall below zero.</p>
                <div class="profiler-chart-legend" aria-label="Memory chart legend">
                    <span><i class="profiler-legend-swatch profiler-legend-allocated"></i>Allocated</span>
                    <span><i class="profiler-legend-swatch profiler-legend-released"></i>Released</span>
                </div>
                <div class="profiler-section-body profiler-memory-chart" data-role="memory-frame-graph"></div>
            </section>
            <section class="profiler-section">
                <h3>Tracked memory</h3>
                <div class="profiler-section-body profiler-stat-grid" data-role="memory-analysis"></div>
                <div class="profiler-table-wrap">
                    <table class="profiler-table">
                        <thead><tr><th>Action</th><th>Resource</th><th>Owner</th><th>Bytes</th><th>Estimate</th></tr></thead>
                        <tbody data-role="memory-events"></tbody>
                    </table>
                </div>
                <div class="profiler-empty" data-role="memory-events-empty" hidden>No tracked changes for this frame and filter.</div>
            </section>
            <section class="profiler-section">
                <h3>Live resource details</h3>
                <div class="profiler-table-wrap">
                    <table class="profiler-table">
                        <thead><tr><th>Resource</th><th>Type</th><th>Owner</th><th>Bytes</th><th>Estimate</th></tr></thead>
                        <tbody data-role="live-resources"></tbody>
                    </table>
                </div>
            </section>
            <section class="profiler-section">
                <h3>Snapshot comparison</h3>
                <div class="profiler-section-body profiler-memory-actions">
                    <label>Base <select data-role="snapshot-base"></select></label>
                    <label>Compare <select data-role="snapshot-target"></select></label>
                    <button type="button" data-action="compare">Compare</button>
                </div>
                <div class="profiler-section-body" data-role="snapshot-comparison"></div>
            </section>
            <section class="profiler-section">
                <h3>Browser memory sample</h3>
                <div class="profiler-section-body" data-role="browser-memory">No sample captured.</div>
            </section>`;

        this._onClick = this._HandleClick.bind(this);
        this._onChange = this._HandleChange.bind(this);
        this._root.addEventListener("click", this._onClick);
        this._root.addEventListener("change", this._onChange);
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
    }

    _HandleClick(event) {
        const button = event.target.closest("button");

        if (!button || !this._root.contains(button)) {
            return;
        }

        if (button.dataset.action === "snapshot") {
            const snapshot = this._memoryTracker.TakeSnapshot();
            this._RefreshSnapshots(snapshot.snapshotId);
        } else if (button.dataset.action === "browser-memory") {
            void this._SampleBrowserMemory();
        } else if (button.dataset.action === "compare") {
            this._CompareSnapshots();
        }
    }

    _HandleChange(event) {
        const role = event.target.dataset.role;

        if (role === "memory-frame") {
            this._selectedFrameNumber = Number(event.target.value);
            this._Refresh(true);
        } else if (role === "memory-owner-filter") {
            this._ownerFilter = event.target.value;
            this._Refresh(true);
            if (
                this._root.querySelector(
                    '[data-role="snapshot-comparison"] table',
                )
            ) {
                this._CompareSnapshots();
            }
        } else if (role === "snapshot-base" || role === "snapshot-target") {
            this._RefreshSnapshots();
        }
    }

    _Refresh(force = false) {
        if (this._root.hidden) {
            return;
        }

        if (!force && this._lastRevision === this._memoryTracker.Revision) {
            return;
        }

        const usage = this._memoryTracker.GetLiveUsage();
        const frames = this._memoryTracker.GetFrames();
        this._RefreshFrameViews(frames, usage);
        this._RefreshLiveResourcesIfChanged();
        this._RefreshSnapshots();
        this._RenderBrowserMemory();
        this._lastRevision = this._memoryTracker.Revision;
    }

    _RefreshFrameViews(frames, usage) {
        const selectedFrame = RefreshFrameSelection(
            this._root.querySelector('[data-role="memory-frame"]'),
            frames,
            this._selectedFrameNumber,
            (frameNumber) => {
                this._selectedFrameNumber = frameNumber;
                this._Refresh(true);
            },
        );
        this._selectedFrameNumber = selectedFrame?.frameNumber ?? null;

        this._RefreshMemoryOwnerFilter(frames, usage);
        this._RenderMemoryGraph(frames);
        this._RenderMemoryAnalysis(usage, selectedFrame);
        this._RenderMemoryEvents(selectedFrame);
    }

    _RefreshLiveResourcesIfChanged() {
        if (
            this._lastLiveResourceRevision !==
                this._memoryTracker.ResourceRevision ||
            this._lastLiveResourceFilter !== this._ownerFilter
        ) {
            this._RenderLiveResources();
            this._lastLiveResourceRevision =
                this._memoryTracker.ResourceRevision;
            this._lastLiveResourceFilter = this._ownerFilter;
        }
    }

    _RefreshMemoryOwnerFilter(frames, usage) {
        const owners = new Set();

        for (const frame of frames) {
            for (const event of frame.events) {
                owners.add(event.owner);
                owners.add(event.resourceOwner);
            }

            for (const owner of Object.keys(frame.ownerFilterTotals)) {
                owners.add(owner);
            }
        }

        for (const owner of Object.keys(usage.bytesByOwner)) {
            owners.add(owner);
        }

        this._ownerFilter = SetOptions(
            this._root.querySelector('[data-role="memory-owner-filter"]'),
            BuildFilterOptions(owners, "All owners"),
            this._ownerFilter,
            (value) => {
                this._ownerFilter = value;
                this._Refresh(true);
            },
        );
    }

    _RenderMemoryGraph(frames) {
        const graph = this._root.querySelector(
            '[data-role="memory-frame-graph"]',
        );
        const recentFrames = frames.slice(-120);

        if (recentFrames.length === 0) {
            graph.replaceChildren(
                CreateEmptyMessage("Start capture to collect memory changes."),
            );
            return;
        }

        const frameChanges = BuildMemoryFrameChanges(
            recentFrames,
            this._ownerFilter,
        );
        const layout = CreateMemoryGraphLayout(frameChanges);
        const ownerLabel = this._ownerFilter || "all owners";
        const svg = CreateSvgElement("svg", {
            class: "profiler-svg-chart",
            viewBox: `0 0 ${layout.width} ${layout.height}`,
            role: "img",
            "aria-label":
                `Tracked memory allocations and releases per frame for ${ownerLabel}.`,
        });
        const title = CreateSvgElement("title");
        title.textContent = `Tracked memory changes for ${ownerLabel}`;
        svg.append(title);

        AppendMemoryGraphGrid(
            svg,
            layout.plotLeft,
            layout.plotRight,
            layout.maxKilobytes,
            layout.yForKilobytes,
        );
        AppendMemoryGraphSeries(
            svg,
            frameChanges,
            this._selectedFrameNumber,
            layout.xForIndex,
            layout.yForKilobytes,
            layout.plotLeft,
            layout.plotRight,
            layout.height,
        );
        graph.replaceChildren(svg);
    }

    _RenderMemoryAnalysis(usage, frame) {
        const analysis = this._root.querySelector(
            '[data-role="memory-analysis"]',
        );
        RenderStatCards(
            analysis,
            BuildMemoryMetrics(usage, frame, this._ownerFilter),
        );
    }

    _RenderMemoryEvents(frame) {
        const body = this._root.querySelector('[data-role="memory-events"]');
        const empty = this._root.querySelector(
            '[data-role="memory-events-empty"]',
        );
        const events = (frame?.events ?? []).filter((event) =>
            MatchesOwnerFilter(
                event.owner,
                event.resourceOwner,
                this._ownerFilter,
            ),
        );

        RenderMemoryRows(body, events, (event) => [
            event.action,
            `${event.label} (${event.resourceType})`,
            event.owner,
            FormatBytes(event.bytes),
            event.estimated ? "Estimated" : "Known size",
        ]);
        empty.hidden = events.length !== 0;
    }

    _RenderLiveResources() {
        const body = this._root.querySelector('[data-role="live-resources"]');
        const resources = this._memoryTracker
            .GetLiveResources()
            .filter((resource) =>
                MatchesOwnerFilter(
                    resource.owner,
                    null,
                    this._ownerFilter,
                ),
            );

        RenderMemoryRows(body, resources, (resource) => [
            resource.label,
            resource.resourceType,
            resource.owner,
            FormatBytes(resource.bytes),
            resource.estimated ? "Estimated" : "Known size",
        ]);
    }

    _RefreshSnapshots(selectedSnapshotId = null) {
        const snapshots = this._memoryTracker.GetSnapshots();
        const options = snapshots.map((snapshot) => ({
            value: snapshot.snapshotId,
            label: `${snapshot.label} (${FormatBytes(snapshot.totalBytes)})`,
        }));
        const baseSelect = this._root.querySelector(
            '[data-role="snapshot-base"]',
        );
        const targetSelect = this._root.querySelector(
            '[data-role="snapshot-target"]',
        );
        const previousBase = baseSelect.value;
        const previousTarget = targetSelect.value;
        const latest = selectedSnapshotId ?? snapshots.at(-1)?.snapshotId ?? "";

        SetOptions(
            baseSelect,
            options,
            previousBase || snapshots[0]?.snapshotId || "",
        );
        SetOptions(
            targetSelect,
            options,
            selectedSnapshotId ?? (previousTarget || latest),
        );
        this._root.querySelector('[data-action="compare"]').disabled =
            snapshots.length < 2;
    }

    _CompareSnapshots() {
        const baseId = Number(
            this._root.querySelector('[data-role="snapshot-base"]').value,
        );
        const targetId = Number(
            this._root.querySelector('[data-role="snapshot-target"]').value,
        );
        const output = this._root.querySelector(
            '[data-role="snapshot-comparison"]',
        );

        try {
            const comparison = this._memoryTracker.CompareSnapshots(
                baseId,
                targetId,
            );
            output.replaceChildren(
                ...BuildSnapshotComparisonContent(
                    comparison,
                    this._ownerFilter,
                ),
            );
        } catch (error) {
            output.textContent =
                error instanceof Error ? error.message : String(error);
        }
    }

    async _SampleBrowserMemory() {
        const button = this._root.querySelector(
            '[data-action="browser-memory"]',
        );
        button.disabled = true;
        button.textContent = "Sampling...";
        this._browserMemorySample =
            await this._memoryTracker.SampleBrowserMemory();
        button.disabled = false;
        button.textContent = "Sample browser memory";
        this._RenderBrowserMemory();
    }

    _RenderBrowserMemory() {
        const output = this._root.querySelector(
            '[data-role="browser-memory"]',
        );
        const sample = this._browserMemorySample;

        if (!sample) {
            output.textContent = "No sample captured.";
            return;
        }

        if (!sample.supported) {
            output.textContent =
                `Unavailable: ${sample.reason} This value is page-wide and is not assigned to a system.`;
            return;
        }

        const breakdown = Array.isArray(sample.breakdown)
            ? sample.breakdown
            : [];
        output.replaceChildren(
            CreateBrowserMemorySummary(sample),
            BuildBrowserMemoryBreakdownContent(breakdown),
        );
    }
}
