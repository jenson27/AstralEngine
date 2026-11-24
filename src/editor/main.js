// Starts the editor shell and mounts its registered panels.

import { StartBrowserApplication } from "../browser-application.js";
import { AstralLogger } from "../diagnostics/logger.js";
import { MemoryTracker } from "../diagnostics/profiling/memory-tracker.js";
import { Profiler } from "../diagnostics/profiling/profiler.js";
import { CreateSceneComponentRegistry } from "../components/register-scene-components.js";
import { EcsDocumentAdapter } from "../serialization/adapters/ecs-document-adapter.js";
import { EditorSelection } from "./editor-selection.js";
import { EditorCommandHistory } from "./editor-command-history.js";
import { EditorSceneAssetTracker } from "./editor-scene-asset-tracker.js";
import { EditorSceneWorkspace } from "./editor-scene-workspace.js";
import { EditorSceneDocumentController } from "./editor-scene-document-controller.js";
import { CreateEditorComponentAuthoringCatalog } from "./component-authoring-catalog.js";
import { EditorSceneAuthoringController } from "./scene-authoring-controller.js";
import { EditorShell } from "./ui/editor-shell.js";
import { RegisterEditorPanels } from "./register-editor-panels.js";

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
let application = null;
let editorSceneAuthoringController = null;
let editorSceneAssetTracker = null;
let editorSceneWorkspace = null;
let editorSceneDocumentController = null;
let isDisposed = false;

function DisposeEditor() {
    if (isDisposed) {
        return;
    }
    isDisposed = true;
    editorSceneDocumentController?.Dispose();
    editorSceneDocumentController = null;
    editorSceneAssetTracker?.Dispose();
    editorSceneAssetTracker = null;

    try {
        editorShell.Dispose();
    } finally {
        editorSceneWorkspace?.Dispose();
        editorSceneWorkspace = null;
        void application?.Dispose();
    }
}

async function MountRunningApplication(runningApplication) {
    if (isDisposed) {
        await runningApplication.Dispose();
        return;
    }

    application = runningApplication;
    editorSceneAssetTracker = new EditorSceneAssetTracker({
        sceneManager: runningApplication.SceneManager,
        history: editorCommandHistory,
        componentCatalog: editorComponentCatalog,
    });
    editorSceneAuthoringController = new EditorSceneAuthoringController({
        sceneManager: runningApplication.SceneManager,
        selection: editorSelection,
        history: editorCommandHistory,
        componentCatalog: editorComponentCatalog,
        getAssetCatalog: runningApplication.GetAssetCatalog,
        assetTracker: editorSceneAssetTracker,
    });
    editorSceneWorkspace = new EditorSceneWorkspace({
        sceneManager: runningApplication.SceneManager,
        commandHistory: editorCommandHistory,
        selection: editorSelection,
        canChangeActiveScene: () =>
            !editorSceneAuthoringController?.IsBusy,
        logger: AstralLogger,
    });
    editorSceneDocumentController = new EditorSceneDocumentController({
        rootElement: root,
        workspace: editorSceneWorkspace,
        documentAdapter: editorDocumentAdapter,
        canChangeScene: () =>
            !editorSceneAuthoringController?.IsBusy,
        logger: AstralLogger,
    });
    editorSceneDocumentController.Mount();

    editorShell.Mount({
        profiler,
        memoryTracker,
        selection: editorSelection,
        commandHistory: editorCommandHistory,
        componentCatalog: editorComponentCatalog,
        assetTracker: editorSceneAssetTracker,
        sceneAuthoringController: editorSceneAuthoringController,
        logger: AstralLogger,
        sceneManager: runningApplication.SceneManager,
        renderer: runningApplication.Renderer,
        getAssetCatalog: runningApplication.GetAssetCatalog,
        openScene: (url, relativePath) =>
            void editorSceneDocumentController?.OpenAssetScene(
                url,
                relativePath,
            ),
    });
}

function HandleEditorStartupFailure(error) {
    const message =
        error instanceof Error ? error.message : String(error);

    DisposeEditor();
    AstralLogger.Error("Editor startup failed.", error);

    if (status) {
        status.textContent = `Editor startup failed: ${message}`;
    }
}

RegisterEditorPanels(editorShell);

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
