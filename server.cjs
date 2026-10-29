// Makes the page and canvas fill the browser window, and resizes the canvas when the window is resized.
// This is a simple implementation of a platform for running WebGL applications in a browser environment.

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const rootDirectory = process.cwd();
const logDirectory = path.join(rootDirectory, "logs");
const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
};

function GetDailyLogFileName(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}.txt`;
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

http.createServer((request, response) => {
    let filePath;

    try {
        const requestUrl = new URL(request.url || "/", "http://localhost");

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

        response.writeHead(200, { "Content-Type": contentType });
        response.end(contents);
    });
}).listen(8000, "localhost", () => {
    console.log("[AstralEngine] Server listening at http://localhost:8000");
});
