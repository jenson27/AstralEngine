// Starts the editor shell and mounts its registered panels.

import { StartBrowserApplication } from "../browser-application.js";
import { AstralLogger } from "../diagnostics/logger.js";
import { MemoryTracker } from "../diagnostics/profiling/memory-tracker.js";
import { Profiler } from "../diagnostics/profiling/profiler.js";
import { ConsolePanel } from "./panels/console-panel.js";
import { MemoryTrackerPanel } from "./panels/memory-tracker-panel.js";
import { ProfilerPanel } from "./panels/profiler-panel.js";
import { SceneHierarchyPanel } from "./panels/scene-hierarchy-panel.js";
import { EditorShell } from "./ui/editor-shell.js";

const root = document.getElementById("editor-shell");
const canvas = document.getElementById("game-canvas");
const status = document.getElementById("engine-status");
const profiler = new Profiler();
const memoryTracker = new MemoryTracker();
const editorShell = new EditorShell(root);
let application = null;
let isDisposed = false;

function DisposeEditor() {
    isDisposed = true;

    try {
        editorShell.Dispose();
    } finally {
        void application?.Dispose();
    }
}

editorShell.RegisterPanel("console", {
    title: "Console",
    dock: "bottom",
    create: (contentElement, context) =>
        new ConsolePanel(context.logger, contentElement),
});
editorShell.RegisterPanel("profiler", {
    title: "Profiler",
    dock: "bottom",
    create: (contentElement, context) =>
        new ProfilerPanel(
            context.profiler,
            contentElement,
            context.renderer,
        ),
});
editorShell.RegisterPanel("memory-tracker", {
    title: "Memory Tracker",
    dock: "bottom",
    create: (contentElement, context) =>
        new MemoryTrackerPanel(context.memoryTracker, contentElement),
});
editorShell.RegisterPanel("hierarchy", {
    title: "Hierarchy",
    dock: "left",
    create: (contentElement, context) =>
        new SceneHierarchyPanel(context.sceneManager, contentElement),
});

window.addEventListener(
    "pagehide",
    () => {
        DisposeEditor();
    },
    { once: true },
);

StartBrowserApplication({ canvas, status, profiler, memoryTracker })
    .then(async (runningApplication) => {
        if (isDisposed) {
            await runningApplication.Dispose();
            return;
        }

        application = runningApplication;
        editorShell.Mount({
            profiler,
            memoryTracker,
            logger: AstralLogger,
            sceneManager: runningApplication.SceneManager,
            renderer: runningApplication.Renderer,
        });
    })
    .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);

        DisposeEditor();
        AstralLogger.Error("Editor startup failed.", error);

        if (status) {
            status.textContent = `Editor startup failed: ${message}`;
        }
    });
