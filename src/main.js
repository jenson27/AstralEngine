// Starts the browser game runtime.

import { StartBrowserApplication } from "./browser-application.js";
import { AstralLogger } from "./diagnostics/logger.js";
import { NeutrophilGame } from "./games/neutrophil-game.js";

const canvas = document.getElementById("game-canvas");
const status = document.getElementById("engine-status");
let application = null;

window.addEventListener(
    "pagehide",
    () => {
        void application?.Dispose();
    },
    { once: true },
);

StartBrowserApplication({ canvas, status, game: NeutrophilGame })
    .then((runningApplication) => {
        application = runningApplication;
    })
    .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);

        AstralLogger.Error("Startup failed.", error);

        if (status) {
            status.textContent = `Startup failed: ${message}`;
        }
    });
