import { AssetBrowserPanel } from "./panels/asset-browser/asset-browser-panel.js";
import { ConsolePanel } from "./panels/diagnostics/console-panel.js";
import { MemoryTrackerPanel } from "./panels/diagnostics/memory-tracker/panel.js";
import { ProfilerPanel } from "./panels/diagnostics/profiler/panel.js";
import { InspectorPanel } from "./panels/inspector/panel.js";
import { SceneHierarchyPanel } from "./panels/scene-hierarchy-panel.js";

export function RegisterEditorPanels(editorShell) {
    if (!editorShell || typeof editorShell.RegisterPanel !== "function") {
        throw new TypeError(
            "Editor panel registration requires an editor shell.",
        );
    }

    editorShell.RegisterPanel("asset-browser", {
        title: "Asset Browser",
        dock: "bottom",
        create: (contentElement, context) =>
            new AssetBrowserPanel(contentElement, {
                logger: context.logger,
                getAssetCatalog: context.getAssetCatalog,
                onOpenScene: context.openScene,
            }),
    });
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
            new SceneHierarchyPanel(
                context.sceneManager,
                context.selection,
                contentElement,
                context.sceneAuthoringController,
            ),
    });
    editorShell.RegisterPanel("inspector", {
        title: "Inspector",
        dock: "right",
        create: (contentElement, context) =>
            new InspectorPanel(
                context.sceneManager,
                context.selection,
                contentElement,
                context.getAssetCatalog,
                context.commandHistory,
                context.componentCatalog,
                context.sceneAuthoringController,
                context.assetTracker,
            ),
    });
}
