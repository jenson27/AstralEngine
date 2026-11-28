// Starts the browser game runtime.

import { StartBrowserGame } from "./browser/browser-application.js";
import { AstralLogger } from "./diagnostics/logger.js";
import { NeutrophilGame } from "./games/neutrophil-game.js";

const canvas = document.getElementById("game-canvas");
const status = document.getElementById("engine-status");
let application = null;
const startupAbortController = new AbortController();

window.addEventListener(
    "pagehide",
    () => {
        startupAbortController.abort();
        void application?.Dispose();
    },
    { once: true },
);

StartBrowserGame({
    canvas,
    status,
    game: NeutrophilGame,
    signal: startupAbortController.signal,
})
    .then((runningApplication) => {
        application = runningApplication;
    })
    .catch((error) => {
        if (startupAbortController.signal.aborted) {
            return;
        }

        const message = error instanceof Error ? error.message : String(error);

        AstralLogger.Error("Startup failed.", error);

        if (status) {
            status.textContent = `Startup failed: ${message}`;
        }
    });
