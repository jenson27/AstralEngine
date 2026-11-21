import { CreateElement } from "../../ui/dom-utils.js";

export function FormatBytes(value) {
    if (value < 1024) {
        return `${value} B`;
    }

    const units = ["KB", "MB", "GB"];
    let size = value / 1024;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
}

export function SelectFrameOrLatest(frames, selectedFrameNumber) {
    return (
        frames.find((frame) => frame.frameNumber === selectedFrameNumber) ??
        frames[frames.length - 1] ??
        null
    );
}

export function BuildFrameOptions(frames) {
    return frames
        .slice()
        .reverse()
        .map((frame) => ({
            value: frame.frameNumber,
            label: `Frame ${frame.frameNumber}`,
        }));
}

export function BuildFilterOptions(values, allLabel) {
    return [
        { value: "", label: allLabel },
        ...[...values]
            .filter(Boolean)
            .sort()
            .map((value) => ({ value, label: value })),
    ];
}

const pendingSelectOptions = new WeakMap();

function HasSameOptions(select, options) {
    const currentOptions = Array.from(select.children);

    return (
        currentOptions.length === options.length &&
        currentOptions.every(
            (option, index) =>
                option.value === String(options[index].value) &&
                option.textContent === options[index].label,
        )
    );
}

function ApplyOptions(select, options, selectedValue) {
    const fragment = document.createDocumentFragment();

    for (const { value, label } of options) {
        const option = CreateElement("option");
        option.value = String(value);
        option.textContent = label;
        fragment.append(option);
    }

    select.replaceChildren(fragment);

    const normalizedValue = String(selectedValue);
    select.value = options.some(
        ({ value }) => String(value) === normalizedValue,
    )
        ? normalizedValue
        : String(options[0]?.value ?? "");

    return select.value;
}

function ClearPendingOptions(select) {
    const pending = pendingSelectOptions.get(select);

    if (!pending) {
        return null;
    }

    select.removeEventListener("blur", pending.onBlur);
    pendingSelectOptions.delete(select);
    return pending;
}

function ApplyPendingOptions(select) {
    const latestUpdate = ClearPendingOptions(select);

    if (!latestUpdate) {
        return;
    }

    const currentValue = select.value;
    const valueToKeep = latestUpdate.options.some(
        ({ value }) => String(value) === String(currentValue),
    )
        ? currentValue
        : latestUpdate.selectedValue;
    const appliedValue = ApplyOptions(
        select,
        latestUpdate.options,
        valueToKeep,
    );

    if (
        appliedValue !== String(latestUpdate.selectedValue) &&
        typeof latestUpdate.onDeferredValueChange === "function"
    ) {
        latestUpdate.onDeferredValueChange(appliedValue);
    }
}

export function SetOptions(
    select,
    options,
    selectedValue,
    onDeferredValueChange = null,
) {
    const pending = pendingSelectOptions.get(select);

    if (HasSameOptions(select, options)) {
        ClearPendingOptions(select);

        if (options.some(({ value }) => String(value) === String(selectedValue))) {
            select.value = String(selectedValue);
        }

        return select.value;
    }

    if (document.activeElement === select) {
        const pendingUpdate = {
            options: options.map(({ value, label }) => ({ value, label })),
            selectedValue,
            onDeferredValueChange,
            onBlur: pending?.onBlur ?? null,
        };

        if (pendingUpdate.onBlur === null) {
            pendingUpdate.onBlur = () => ApplyPendingOptions(select);
            select.addEventListener("blur", pendingUpdate.onBlur);
        }

        pendingSelectOptions.set(select, pendingUpdate);
        return select.value;
    }

    ClearPendingOptions(select);

    return ApplyOptions(select, options, selectedValue);
}

export function RefreshFrameSelection(
    select,
    frames,
    selectedFrameNumber,
    onSelectionChange,
) {
    const selectedFrame = SelectFrameOrLatest(frames, selectedFrameNumber);

    SetOptions(
        select,
        BuildFrameOptions(frames),
        selectedFrame?.frameNumber ?? "",
        (value) =>
            onSelectionChange(value === "" ? null : Number(value)),
    );

    return selectedFrame;
}

export function AppendTableCells(row, values) {
    for (const value of values) {
        const cell = CreateElement("td");
        cell.textContent = String(value);
        row.append(cell);
    }
}

export function AppendTableRow(body, values, className = "") {
    const row = CreateElement("tr", className);
    AppendTableCells(row, values);

    body.append(row);
}

export function CreateDataTable(headers) {
    const table = CreateElement("table", "profiler-table");
    const header = CreateElement("thead");
    const headerRow = CreateElement("tr");
    const body = CreateElement("tbody");

    for (const label of headers) {
        const cell = CreateElement("th");
        cell.textContent = label;
        headerRow.append(cell);
    }

    header.append(headerRow);
    table.append(header, body);
    return { table, body };
}

export function RenderStatCards(container, metrics) {
    const fragment = document.createDocumentFragment();

    for (const [label, value] of metrics) {
        const card = CreateElement("div", "profiler-stat");
        const name = CreateElement("span");
        const content = CreateElement("strong");
        name.textContent = label;
        content.textContent = String(value);
        card.append(name, content);
        fragment.append(card);
    }

    container.replaceChildren(fragment);
}

export function CreateSvgElement(tagName, attributes = {}) {
    const element = document.createElementNS(
        "http://www.w3.org/2000/svg",
        tagName,
    );

    for (const [name, value] of Object.entries(attributes)) {
        element.setAttribute(name, String(value));
    }

    return element;
}

export function AppendSvgText(svg, text, x, y, className, anchor = "middle") {
    const label = CreateSvgElement("text", {
        x,
        y,
        class: className,
        "text-anchor": anchor,
    });
    label.textContent = text;
    svg.append(label);
    return label;
}

export function AppendSvgGridLinesAndLabels(svg, {
    ticks,
    plotLeft,
    plotRight,
    yForValue,
    formatLabel,
    lineClassForTick,
}) {
    for (const tick of ticks) {
        const y = yForValue(tick);
        svg.append(
            CreateSvgElement("line", {
                x1: plotLeft,
                y1: y,
                x2: plotRight,
                y2: y,
                class:
                    lineClassForTick?.(tick) ??
                    "profiler-chart-grid-line",
            }),
        );
        AppendSvgText(
            svg,
            formatLabel(tick),
            plotLeft - 8,
            y + 4,
            "profiler-chart-label",
            "end",
        );
    }
}

export function CreateFrameIndexScale(frameCount, plotLeft, plotWidth) {
    return (index) =>
        plotLeft +
        (frameCount === 1
            ? plotWidth / 2
            : (index / (frameCount - 1)) * plotWidth);
}

export function AppendFrameRangeLabels(
    svg,
    firstFrameNumber,
    lastFrameNumber,
    plotLeft,
    plotRight,
    height,
) {
    AppendSvgText(
        svg,
        String(firstFrameNumber),
        plotLeft,
        height - 8,
        "profiler-chart-label",
        "start",
    );
    AppendSvgText(
        svg,
        String(lastFrameNumber),
        plotRight,
        height - 8,
        "profiler-chart-label",
        "end",
    );
}

export function CreateEmptyMessage(message) {
    const empty = CreateElement("div", "profiler-empty");
    empty.textContent = message;
    return empty;
}
