// Starts the editor shell and mounts its registered panels.

import { StartBrowserApplication } from "../browser-application.js";
import { AstralLogger } from "../diagnostics/logger.js";
import { MemoryTracker } from "../diagnostics/profiling/memory-tracker.js";
import { Profiler } from "../diagnostics/profiling/profiler.js";
import { CreateSceneComponentRegistry } from "../components/register-scene-components.js";
import { EcsDocumentAdapter } from "../serialization/adapters/ecs-document-adapter.js";
import { JsonFormat } from "../serialization/json-format.js";
import { ConsolePanel } from "./panels/console-panel.js";
import { EditorSelection } from "./editor-selection.js";
import { EditorCommandHistory } from "./editor-command-history.js";
import { EditorDocumentSession } from "./editor-document-session.js";
import { CreateEditorComponentAuthoringCatalog } from "./component-authoring-catalog.js";
import { EditorSceneAuthoringController } from "./scene-authoring-controller.js";
import { InspectorPanel } from "./panels/inspector-panel.js";
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
const editorSelection = new EditorSelection();
const editorCommandHistory = new EditorCommandHistory();
const editorComponentCatalog = CreateEditorComponentAuthoringCatalog();
const editorDocumentAdapter = new EcsDocumentAdapter(
    CreateSceneComponentRegistry(),
);
const exportSceneButton = document.getElementById("editor-export-scene");
const importSceneButton = document.getElementById("editor-import-scene");
const importSceneFileInput = document.getElementById(
    "editor-import-scene-file",
);
const editorDocumentStatus = document.querySelector(
    '[data-role="editor-document-status"]',
);
let application = null;
let editorSceneAuthoringController = null;
let editorDocumentSession = null;
let unsubscribeEditorDocument = null;
let isDisposed = false;

function GetErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

function UpdateEditorDocumentStatus() {
    if (!editorDocumentStatus || !exportSceneButton) {
        return;
    }

    const hasScene = Boolean(editorDocumentSession?.Scene);
    exportSceneButton.disabled = !hasScene;
    if (importSceneButton) {
        importSceneButton.disabled = !application;
    }
    editorDocumentStatus.textContent = !hasScene
        ? "Editor document · No scene"
        : editorDocumentSession.IsDirty
          ? "Editor document · Unsaved changes"
          : "Editor document · Saved";
}

function OpenEditorScenePicker() {
    importSceneFileInput?.click();
}

async function LoadImportedEditorScene(data, fileName) {
    editorDocumentStatus.textContent = `Editor document · Importing ${fileName}`;
    root.inert = true;
    try {
        const scene = await application.SceneManager.LoadSceneData(data);

        editorCommandHistory.SetScene(scene);
        editorSelection.Clear();
        editorDocumentStatus.textContent = `Editor document · Imported ${fileName}`;
    } finally {
        root.inert = false;
    }
}

async function ImportEditorSceneFile() {
    const file = importSceneFileInput?.files?.[0];
    if (!file || !application) {
        return;
    }

    importSceneButton.disabled = true;

    try {
        const data = JsonFormat.Parse(await file.text());

        if (
            editorDocumentSession?.IsDirty &&
            !window.confirm(
                "Importing this scene will discard unsaved changes. Continue?",
            )
        ) {
            return;
        }

        await LoadImportedEditorScene(data, file.name);
    } catch (error) {
        const message = GetErrorMessage(error);
        editorDocumentStatus.textContent = `Editor import failed: ${message}`;
        AstralLogger.Error("Editor scene import failed.", error);
    } finally {
        importSceneFileInput.value = "";
        importSceneButton.disabled = !application || isDisposed;
    }
}

function CreateEditorSceneFileName(sceneName) {
    const safeSceneName =
        sceneName
            .trim()
            .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
            .replace(/[. ]+$/g, "") || "scene";

    return `${safeSceneName}.editor-scene.json`;
}

function DownloadEditorScene() {
    const scene = editorDocumentSession?.Scene;
    if (!scene) {
        return;
    }

    try {
        const documentData = editorDocumentAdapter.Serialize(scene);
        const json = JsonFormat.Stringify(documentData);
        const blob = new Blob([json], { type: "application/json" });
        const objectUrl = URL.createObjectURL(blob);
        const downloadLink = document.createElement("a");
        downloadLink.href = objectUrl;
        downloadLink.download = CreateEditorSceneFileName(scene.Name);
        downloadLink.hidden = true;
        document.body.append(downloadLink);
        downloadLink.click();
        downloadLink.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
        editorDocumentSession.MarkExported(scene);
    } catch (error) {
        const message = GetErrorMessage(error);
        if (editorDocumentStatus) {
            editorDocumentStatus.textContent = `Editor export failed: ${message}`;
        }
        AstralLogger.Error("Editor scene export failed.", error);
    }
}

function DisposeEditor() {
    isDisposed = true;
    unsubscribeEditorDocument?.();
    editorDocumentSession?.Dispose();
    exportSceneButton?.removeEventListener("click", DownloadEditorScene);
    importSceneButton?.removeEventListener("click", OpenEditorScenePicker);
    importSceneFileInput?.removeEventListener("change", ImportEditorSceneFile);

    try {
        editorShell.Dispose();
    } finally {
        void application?.Dispose();
    }
}

async function MountRunningApplication(runningApplication) {
    if (isDisposed) {
        await runningApplication.Dispose();
        return;
    }

    application = runningApplication;
    editorSceneAuthoringController = new EditorSceneAuthoringController({
        sceneManager: runningApplication.SceneManager,
        selection: editorSelection,
        history: editorCommandHistory,
        componentCatalog: editorComponentCatalog,
        getAssetCatalog: runningApplication.GetAssetCatalog,
    });
    editorDocumentSession = new EditorDocumentSession(
        editorCommandHistory,
        runningApplication.SceneManager.ActiveScene,
    );
    unsubscribeEditorDocument = editorDocumentSession.Subscribe(
        UpdateEditorDocumentStatus,
    );
    editorShell.Mount({
        profiler,
        memoryTracker,
        selection: editorSelection,
        commandHistory: editorCommandHistory,
        componentCatalog: editorComponentCatalog,
        sceneAuthoringController: editorSceneAuthoringController,
        logger: AstralLogger,
        sceneManager: runningApplication.SceneManager,
        renderer: runningApplication.Renderer,
        getAssetCatalog: runningApplication.GetAssetCatalog,
    });
}

function HandleEditorStartupFailure(error) {
    const message = GetErrorMessage(error);

    DisposeEditor();
    AstralLogger.Error("Editor startup failed.", error);

    if (status) {
        status.textContent = `Editor startup failed: ${message}`;
    }
}

exportSceneButton?.addEventListener("click", DownloadEditorScene);
importSceneButton?.addEventListener("click", OpenEditorScenePicker);
importSceneFileInput?.addEventListener("change", ImportEditorSceneFile);

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
            null,
            context.getAssetCatalog,
            context.commandHistory,
            context.componentCatalog,
            context.sceneAuthoringController,
        ),
});

window.addEventListener(
    "pagehide",
    () => {
        DisposeEditor();
    },
    { once: true },
);

StartBrowserApplication({ canvas, status, profiler, memoryTracker })
    .then(MountRunningApplication)
    .catch(HandleEditorStartupFailure);
