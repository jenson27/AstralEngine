// This module provides a logging utility for the Astral Engine,
// allowing developers to log messages at different levels (DEBUG, INFO, WARN, ERROR) with timestamps and optional details.

const logMethods = {
    DEBUG: (...argumentsList) => console.debug(...argumentsList),
    INFO: (...argumentsList) => console.info(...argumentsList),
    WARN: (...argumentsList) => console.warn(...argumentsList),
    ERROR: (...argumentsList) => console.error(...argumentsList),
};

function ConsoleLogSink(logEntry) {
    const logMessage =
        `[AstralEngine] [${logEntry.timestamp}] ` +
        `[${logEntry.level}] ${logEntry.message}`;
    const writeLog = logMethods[logEntry.level] ?? logMethods.INFO;

    if (logEntry.details === undefined) {
        writeLog(logMessage);
    } else {
        writeLog(logMessage, logEntry.details);
    }
}

function FileLogSink(logEntry) {
    if (typeof window === "undefined") {
        return;
    }

    fetch("/api/logs", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(logEntry),
    }).catch((error) => {
        console.error(
            "[AstralEngine] Failed to send log entry to the server.",
            error,
        );
    });
}

const logSinks = new Set([ConsoleLogSink, FileLogSink]);

export class AstralLogger {
    static Debug(message, details) {
        AstralLogger._Write("DEBUG", message, details);
    }

    static Info(message, details) {
        AstralLogger._Write("INFO", message, details);
    }

    static Warn(message, details) {
        AstralLogger._Write("WARN", message, details);
    }

    static Error(message, details) {
        AstralLogger._Write("ERROR", message, details);
    }

    static AddSink(logSink) {
        if (typeof logSink !== "function") {
            throw new TypeError("AstralLogger.AddSink requires a function.");
        }

        logSinks.add(logSink);
        return () => logSinks.delete(logSink);
    }

    static _Write(level, message, details) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            level,
            message: String(message),
        };

        if (details !== undefined) {
            logEntry.details = AstralLogger._SerializeDetails(details);
        }

        for (const logSink of logSinks) {
            try {
                logSink(logEntry);
            } catch (error) {
                console.error("[AstralEngine] A log sink failed.", error);
            }
        }
    }

    static _SerializeDetails(details) {
        if (details instanceof AggregateError) {
            return {
                name: details.name,
                message: details.message,
                stack: details.stack,
                errors: Array.from(details.errors, (error) =>
                    AstralLogger._SerializeDetails(error),
                ),
            };
        }

        if (details instanceof Error) {
            const serializedError = {
                name: details.name,
                message: details.message,
                stack: details.stack,
            };

            if (details.cause !== undefined) {
                serializedError.cause = AstralLogger._SerializeDetails(
                    details.cause,
                );
            }

            if (details.command !== undefined) {
                serializedError.command = details.command;
            }

            return serializedError;
        }

        try {
            return JSON.parse(JSON.stringify(details));
        } catch {
            return String(details);
        }
    }
}
