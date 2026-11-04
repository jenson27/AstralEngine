# Logging

## Purpose

`AstralLogger` creates structured log entries and sends each entry to its registered sinks. The default sinks write to the browser console and post browser logs to the local server. It does not filter by level or rotate files itself; `server.cjs` writes received entries to daily files. See [Scene Management](../core/SCENE_MANAGEMENT_README.md) for systems that report lifecycle failures.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `AstralLogger.Debug()` / `Info()` / `Warn()` / `Error()` | Create entries at the requested level |
| `AstralLogger.AddSink(logSink)` | Adds a sink and returns a function that removes it |
| `ConsoleLogSink` | Formats entries and sends them to the matching console method |
| `FileLogSink` | Posts browser entries to `/api/logs` |
| `server.cjs` `/api/logs` | Validates entries and appends them to a date-named file |

## Log entry

- `timestamp` - Local ISO date-time string with UTC offset
- `level` - `DEBUG`, `INFO`, `WARN`, or `ERROR`
- `message` - String form of the supplied message
- `details` - Optional JSON-compatible data or serialized error information

## Writing and sinks

- Each logging method writes to every sink in the sink set
- `AddSink()` requires a function; adding the same function twice does not add a duplicate
- The returned removal function unregisters that sink
- Sink exceptions are caught and reported with `console.error`; other sinks still run
- Error details include name, message, and stack, plus supported `cause` and command data
- `AggregateError` details include recursively serialized member errors
- Other detail values are copied through JSON serialization; if that fails, they fall back to `String(details)`
- The console sink uses `console.debug`, `console.info`, `console.warn`, or `console.error`

## Server log files

- In a browser, the file sink posts JSON to `/api/logs`
- The server writes one line to `logs/YYYY-MM-DD.txt`, using the server's local date for the file name
- The line includes a readable timestamp, level, message, and optional serialized details
- Malformed JSON or a record without string `timestamp`, `level`, and `message` receives HTTP 400
- A successful append returns HTTP 204; a write failure returns HTTP 500
- If the request fails, the browser logs a console error; logging does not retry the post

## Current scope

- The default file sink is active only in a browser
- The server stores plain text log lines and does not impose a size limit or rotation policy
- There is no minimum-level filter

## Source

- `src/diagnostics/logger.js`
- `server.cjs`
