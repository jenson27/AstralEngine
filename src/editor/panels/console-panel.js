import { CreateElement } from "../ui/dom-utils.js";

const MAX_CONSOLE_ENTRIES = 2000;

function FormatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime())
        ? timestamp
        : date.toLocaleTimeString();
}

function MatchesFilters(logEntry, levelFilter, searchFilter) {
    return (
        (levelFilter === "" || logEntry.level === levelFilter) &&
        (searchFilter === "" ||
            `${logEntry.level} ${logEntry.message}`
                .toLowerCase()
                .includes(searchFilter))
    );
}

function CreateLogEntryElement(logEntry, entryId) {
    const entry = CreateElement("article", "console-log-entry");
    entry.dataset.entryId = String(entryId);
    entry.dataset.level = logEntry.level.toLowerCase();

    const timestamp = CreateElement("time", "console-log-timestamp");
    timestamp.dateTime = logEntry.timestamp;
    timestamp.textContent = FormatTimestamp(logEntry.timestamp);

    const level = CreateElement("span", "console-log-level");
    level.textContent = logEntry.level;

    const message = CreateElement("span", "console-log-message");
    message.textContent = logEntry.message;
    entry.append(timestamp, level, message);

    if (logEntry.details !== undefined) {
        const details = CreateElement("pre", "console-log-details");
        details.textContent = JSON.stringify(logEntry.details, null, 2);
        entry.append(details);
    }

    return entry;
}

export class ConsolePanel {
    constructor(logger, panelElement) {
        if (
            !logger ||
            typeof logger.AddSink !== "function" ||
            typeof logger.GetHistory !== "function"
        ) {
            throw new TypeError("ConsolePanel requires a compatible logger.");
        }

        if (!(panelElement instanceof HTMLElement)) {
            throw new TypeError("ConsolePanel requires a panel element.");
        }

        this._logger = logger;
        this._root = panelElement;
        this._root.classList.add("diagnostic-panel", "console-panel");
        this._nextEntryId = 1;
        this._entries = logger
            .GetHistory()
            .slice(-MAX_CONSOLE_ENTRIES)
            .map((logEntry) => ({
                entryId: this._nextEntryId++,
                logEntry,
            }));
        this._levelFilter = "";
        this._searchFilter = "";
        this._root.innerHTML = `
            <div class="console-toolbar">
                <label>Level
                    <select data-role="level-filter">
                        <option value="">All</option>
                        <option value="DEBUG">Debug</option>
                        <option value="INFO">Info</option>
                        <option value="WARN">Warning</option>
                        <option value="ERROR">Error</option>
                    </select>
                </label>
                <label>Search
                    <input type="search" data-role="search-filter" placeholder="Filter messages" />
                </label>
                <button type="button" data-action="clear">Clear</button>
                <span class="console-entry-count" data-role="entry-count"></span>
            </div>
            <div class="console-output" data-role="output" role="log" aria-label="Engine logs" aria-live="off">
                <div class="console-log-list" data-role="entries"></div>
            </div>`;

        this._onClick = this._HandleClick.bind(this);
        this._onChange = this._HandleChange.bind(this);
        this._onInput = this._HandleInput.bind(this);
        this._onLog = (logEntry) => this._AppendEntry(logEntry);
        this._root.addEventListener("click", this._onClick);
        this._root.addEventListener("change", this._onChange);
        this._root.addEventListener("input", this._onInput);
        this._RenderEntries(true);
        this._removeLogSink = logger.AddSink(this._onLog);
    }

    Dispose() {
        this._removeLogSink?.();
        this._root.removeEventListener("click", this._onClick);
        this._root.removeEventListener("change", this._onChange);
        this._root.removeEventListener("input", this._onInput);
    }

    _HandleClick(event) {
        const button = event.target.closest("button");

        if (!button || !this._root.contains(button)) {
            return;
        }

        if (button.dataset.action === "clear") {
            this._entries.length = 0;
            this._RenderEntries();
        }
    }

    _HandleChange(event) {
        if (event.target.dataset.role === "level-filter") {
            this._levelFilter = event.target.value;
            this._RenderEntries();
        }
    }

    _HandleInput(event) {
        if (event.target.dataset.role === "search-filter") {
            this._searchFilter = event.target.value.trim().toLowerCase();
            this._RenderEntries();
        }
    }

    _AppendEntry(logEntry) {
        const entryRecord = {
            entryId: this._nextEntryId,
            logEntry,
        };
        this._nextEntryId += 1;
        this._entries.push(entryRecord);
        let removedEntry = null;

        if (this._entries.length > MAX_CONSOLE_ENTRIES) {
            removedEntry = this._entries.shift();
        }

        const output = this._root.querySelector('[data-role="output"]');
        const shouldScrollToBottom =
            output.scrollHeight - output.scrollTop - output.clientHeight < 24;
        const entriesElement = this._root.querySelector(
            '[data-role="entries"]',
        );

        if (removedEntry) {
            entriesElement
                .querySelector(`[data-entry-id="${removedEntry.entryId}"]`)
                ?.remove();
        }

        if (
            MatchesFilters(
                logEntry,
                this._levelFilter,
                this._searchFilter,
            )
        ) {
            entriesElement.append(
                CreateLogEntryElement(logEntry, entryRecord.entryId),
            );
        }

        this._UpdateEntryCount();
        if (shouldScrollToBottom) {
            output.scrollTop = output.scrollHeight;
        }
    }

    _RenderEntries(scrollToBottom = false) {
        const output = this._root.querySelector('[data-role="output"]');
        const entriesElement = this._root.querySelector(
            '[data-role="entries"]',
        );
        const previousScrollTop = output.scrollTop;
        const fragment = document.createDocumentFragment();

        for (const { entryId, logEntry } of this._entries) {
            if (
                !MatchesFilters(
                    logEntry,
                    this._levelFilter,
                    this._searchFilter,
                )
            ) {
                continue;
            }

            fragment.append(CreateLogEntryElement(logEntry, entryId));
        }

        entriesElement.replaceChildren(fragment);
        this._UpdateEntryCount();
        output.scrollTop = scrollToBottom
            ? output.scrollHeight
            : Math.min(previousScrollTop, output.scrollHeight);
    }

    _UpdateEntryCount() {
        const visibleCount = this._root.querySelectorAll(
            ".console-log-entry",
        ).length;
        this._root.querySelector('[data-role="entry-count"]').textContent =
            `${visibleCount} shown · ${this._entries.length} retained`;
    }
}
