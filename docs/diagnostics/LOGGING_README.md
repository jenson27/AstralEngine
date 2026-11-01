# Logging

## Purpose

`AstralLogger` records messages in the browser console and sends them to the local server for date-based log files. It supports four severity levels and optional detail data.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `AstralLogger.Debug()` | Records a debug message. |
| `AstralLogger.Info()` | Records an information message. |
| `AstralLogger.Warn()` | Records a warning. |
| `AstralLogger.Error()` | Records an error. |
| `AstralLogger.AddSink()` | Adds a custom output sink and returns a function that removes it. |
| `ConsoleLogSink` | Formats the timestamp for readability and writes each message to the matching browser console method. |
| `FileLogSink` | Sends each message to the server using `POST /api/logs`. |
| `server.cjs` | Validates log requests and appends entries to date-based files in `logs/`. |

## Log entry

Each entry contains:

- `timestamp` - The time created in ISO format. The browser console formats it with the browser locale. Server log files show the local date,
  hour, and minute.
- `level` - `DEBUG`, `INFO`, `WARN`, or `ERROR`.
- `message` - The message converted to a string.
- `details` - Optional extra data.

Error details include the error name, message, and stack. Other details are copied through JSON serialization. If they cannot be serialized, the logger converts them to a string.

## Output flow

1. Code calls an `AstralLogger` method.
2. The logger creates one entry with a timestamp, level, message, and optional details.
3. The console and file sinks receive the entry.
4. The file sink sends the entry to `server.cjs`.
5. The server appends it to a date-based file in `logs/`.

## Current scope

- The logger does not keep an in-memory message history.
- It does not provide severity filters or an editor console.
- File output requires the local server and its `/api/logs` endpoint.
