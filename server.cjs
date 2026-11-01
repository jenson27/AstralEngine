// Makes the page and canvas fill the browser window, and resizes the canvas when the window is resized.
// This is a simple implementation of a platform for running WebGL applications in a browser environment.

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const rootDirectory = process.cwd();
const logDirectory = path.join(rootDirectory, "logs");
const assetDirectory = path.join(rootDirectory, "assets");
const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
};
const hotReloadClients = new Set();
const pendingAssetPaths = new Set();
let fullRescanPending = false;
let assetChangeTimer = null;
let assetWatcher = null;
let assetWatcherRetryTimer = null;
let assetWatcherRetryDelayMs = 1000;
let assetWatcherNeedsRescan = false;

function GetDailyLogFileName(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}.txt`;
}

function HandleHotReloadStream(_request, response) {
    response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-store",
        Connection: "keep-alive",
    });
    response.write("retry: 1000\n\n: connected\n\n");
    hotReloadClients.add(response);

    const heartbeat = setInterval(() => {
        if (response.destroyed) {
            clearInterval(heartbeat);
            hotReloadClients.delete(response);
            return;
        }

        response.write(": keepalive\n\n");
    }, 15000);
    heartbeat.unref();

    response.on("close", () => {
        clearInterval(heartbeat);
        hotReloadClients.delete(response);
    });

}

function BroadcastAssetChanges(message) {
    const event =
        "event: asset-change\n" +
        `data: ${JSON.stringify(message)}\n\n`;

    for (const client of hotReloadClients) {
        if (client.destroyed) {
            hotReloadClients.delete(client);
            continue;
        }

        try {
            client.write(event);
        } catch {
            hotReloadClients.delete(client);
        }
    }
}

function FlushAssetChanges() {
    assetChangeTimer = null;

    if (!fullRescanPending && pendingAssetPaths.size === 0) {
        return;
    }

    const message = {
        paths: Array.from(pendingAssetPaths),
        rescan: fullRescanPending,
    };

    pendingAssetPaths.clear();
    fullRescanPending = false;
    BroadcastAssetChanges(message);
}

function QueueAssetChange(sourcePath) {
    if (sourcePath === null) {
        fullRescanPending = true;
    } else if (!fullRescanPending) {
        pendingAssetPaths.add(sourcePath);
    }

    clearTimeout(assetChangeTimer);
    assetChangeTimer = setTimeout(FlushAssetChanges, 100);
}

function ScheduleAssetWatcherRestart() {
    if (assetWatcherRetryTimer) {
        return;
    }

    const delayMs = assetWatcherRetryDelayMs;
    assetWatcherRetryDelayMs = Math.min(delayMs * 2, 30000);

    assetWatcherRetryTimer = setTimeout(() => {
        assetWatcherRetryTimer = null;
        StartAssetWatcher();
    }, delayMs);
    assetWatcherRetryTimer.unref();
}

function LogWatcherError(message, error) {
    void import("./src/diagnostics/logger.js")
        .then(({ AstralLogger }) => {
            AstralLogger.Error(message, error);
        })
        .catch((loggerError) => {
            console.error("Could not load logger.js.", loggerError);
        });
}

function HandleAssetWatcherFailure(watcher, error) {
    if (assetWatcher !== watcher) {
        return;
    }

    assetWatcher = null;
    assetWatcherNeedsRescan = true;
    watcher.close();

    LogWatcherError("Asset hot-reload watcher failed.", error);
    ScheduleAssetWatcherRestart();
}

function HandleAssetWatcherClose(watcher) {
    if (assetWatcher !== watcher) {
        return;
    }

    assetWatcher = null;
    assetWatcherNeedsRescan = true;
    ScheduleAssetWatcherRestart();
}

function StartAssetWatcher() {
    if (assetWatcher) {
        return assetWatcher;
    }

    try {
        const watcher = fs.watch(
            assetDirectory,
            { recursive: true },
            (_eventType, fileName) => {
                if (fileName === null || fileName === undefined) {
                    QueueAssetChange(null);
                    return;
                }

                const changedFilePath = path.resolve(
                    assetDirectory,
                    fileName.toString(),
                );

                if (
                    changedFilePath !== assetDirectory &&
                    !changedFilePath.startsWith(
                        `${assetDirectory}${path.sep}`,
                    )
                ) {
                    return;
                }

                const relativePath = path.relative(
                    rootDirectory,
                    changedFilePath,
                );
                const sourcePath =
                    "/" + relativePath.split(path.sep).join("/");

                QueueAssetChange(sourcePath);
            },
        );

        assetWatcher = watcher;
        watcher.on("error", (error) =>
            HandleAssetWatcherFailure(watcher, error),
        );
        watcher.on("close", () =>
            HandleAssetWatcherClose(watcher),
        );

        assetWatcherRetryDelayMs = 1000;

        if (assetWatcherNeedsRescan) {
            assetWatcherNeedsRescan = false;
            QueueAssetChange(null);
        }

        return watcher;
    } catch (error) {
        assetWatcherNeedsRescan = true;
        LogWatcherError(
            "Could not start the asset hot-reload watcher.",
            error,
        );
        ScheduleAssetWatcherRestart();
        return null;
    }
}

async function WriteLogEntry(request, response) {
    let requestBody = "";

    try {
        for await (const chunk of request) {
            requestBody += chunk.toString("utf8");
        }

        let logEntry;

        try {
            logEntry = JSON.parse(requestBody);
        } catch {
            response.writeHead(400);
            response.end("Invalid JSON.");
            return;
        }

        if (
            !logEntry ||
            typeof logEntry !== "object" ||
            typeof logEntry.timestamp !== "string" ||
            typeof logEntry.level !== "string" ||
            typeof logEntry.message !== "string"
        ) {
            response.writeHead(400);
            response.end("Invalid log entry.");
            return;
        }

        const date = new Date();
        const fileName = GetDailyLogFileName(date);
        const logFilePath = path.join(logDirectory, fileName);
        const details =
            logEntry.details === undefined
                ? ""
                : ` ${JSON.stringify(logEntry.details)}`;
        const logLine =
            `[${logEntry.timestamp}] [${logEntry.level}] ` +
            `${logEntry.message}${details}\n`;

        await fs.promises.mkdir(logDirectory, { recursive: true });
        await fs.promises.appendFile(logFilePath, logLine, "utf8");

        response.writeHead(204);
        response.end();
    } catch (error) {
        console.error("Failed to write log entry.", error);
        response.writeHead(500);
        response.end("Failed to write log entry.");
    }
}

const server = http.createServer((request, response) => {
    let filePath;

    try {
        const requestUrl = new URL(request.url || "/", "http://localhost");

        if (
            request.method === "GET" &&
            requestUrl.pathname === "/api/hot-reload"
        ) {
            HandleHotReloadStream(request, response);
            return;
        }

        if (request.method === "POST" && requestUrl.pathname === "/api/logs") {
            void WriteLogEntry(request, response);
            return;
        }

        const requestPath =
            requestUrl.pathname === "/"
                ? "/index.html"
                : decodeURIComponent(requestUrl.pathname);

        filePath = path.resolve(rootDirectory, `.${requestPath}`);
    } catch {
        response.writeHead(400);
        response.end("Bad request");
        return;
    }

    if (
        filePath !== rootDirectory &&
        !filePath.startsWith(`${rootDirectory}${path.sep}`)
    ) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
    }

    fs.readFile(filePath, (error, contents) => {
        if (error) {
            response.writeHead(404);
            response.end("Not found");
            return;
        }

        const contentType =
            contentTypes[path.extname(filePath)] ?? "application/octet-stream";

        response.writeHead(200, {
            "Content-Type": contentType,
            "Cache-Control": "no-store",
        });
        response.end(contents);
    });
});

StartAssetWatcher();

server.listen(8000, "localhost", () => {
    console.log("[AstralEngine] Server listening at http://localhost:8000");
});
