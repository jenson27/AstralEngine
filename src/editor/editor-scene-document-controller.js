import { AstralLogger } from "../diagnostics/logger.js";
import { JsonFormat } from "../serialization/json-format.js";
import { SceneDocumentTabs } from "./ui/scene-document-tabs.js";

function GetRequiredElement(rootElement, selector, name) {
    const element = rootElement.querySelector(selector);
    if (!(element instanceof HTMLElement)) {
        throw new TypeError(
            "Editor scene document controller requires " + name + ".",
        );
    }
    return element;
}

function GetErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

function CreateEditorSceneFileName(sceneName) {
    const safeSceneName =
        sceneName
            .trim()
            .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
            .replace(/[. ]+$/g, "") || "scene";

    return safeSceneName + ".editor-scene.json";
}

export class EditorSceneDocumentController {
    constructor({
        rootElement,
        workspace,
        documentAdapter,
        canChangeScene = () => true,
        logger = AstralLogger,
    }) {
        if (!(rootElement instanceof HTMLElement)) {
            throw new TypeError(
                "Editor scene document controller requires a root element.",
            );
        }
        if (
            !workspace ||
            typeof workspace.OpenAssetScene !== "function" ||
            typeof workspace.OpenImportedScene !== "function" ||
            typeof workspace.GetDocument !== "function" ||
            typeof workspace.CloseDocument !== "function" ||
            typeof workspace.ActivateDocument !== "function" ||
            typeof workspace.Subscribe !== "function"
        ) {
            throw new TypeError(
                "Editor scene document controller requires a scene workspace.",
            );
        }
        if (
            !documentAdapter ||
            typeof documentAdapter.Serialize !== "function"
        ) {
            throw new TypeError(
                "Editor scene document controller requires a document adapter.",
            );
        }
        if (typeof canChangeScene !== "function") {
            throw new TypeError(
                "Editor scene document controller requires a scene change guard.",
            );
        }

        this._root = rootElement;
        this._workspace = workspace;
        this._documentAdapter = documentAdapter;
        this._canChangeScene = canChangeScene;
        this._logger = logger;
        this._status = rootElement.querySelector("#engine-status");
        this._documentStatus = rootElement.querySelector(
            '[data-role="editor-document-status"]',
        );
        this._emptySceneState = rootElement.querySelector(
            '[data-role="empty-scene"]',
        );
        this._exportButton = GetRequiredElement(
            rootElement,
            "#editor-export-scene",
            "an export button",
        );
        this._importButton = GetRequiredElement(
            rootElement,
            "#editor-import-scene",
            "an import button",
        );
        this._importFileInput = GetRequiredElement(
            rootElement,
            "#editor-import-scene-file",
            "an import file input",
        );
        this._sceneTabsRoot = GetRequiredElement(
            rootElement,
            "#editor-scene-tabs",
            "a scene tabs root",
        );
        this._unsavedCloseDialog =
            rootElement.ownerDocument.getElementById(
                "editor-unsaved-close-dialog",
            );
        this._unsavedCloseMessage =
            rootElement.ownerDocument.getElementById(
                "editor-unsaved-close-message",
            );
        this._sceneTabs = null;
        this._unsubscribeWorkspace = null;
        this._isMounted = false;
        this._isDisposed = false;
        this._onExportClick = () => this._DownloadActiveScene();
        this._onImportClick = () => this._OpenEditorScenePicker();
        this._onImportFileChange = () => {
            void this._ImportEditorSceneFile();
        };
        this._onUnsavedCloseDialogClick = (event) =>
            this._HandleUnsavedCloseDialogClick(event);
        this._onWorkspaceChange = () =>
            this._UpdateEditorDocumentStatus();
    }

    Mount() {
        if (this._isMounted || this._isDisposed) {
            throw new Error(
                "Editor scene document controller can only be mounted once.",
            );
        }

        this._sceneTabs = new SceneDocumentTabs(this._sceneTabsRoot, {
            onSelect: (documentId) => this._ActivateEditorScene(documentId),
            onClose: (documentId) =>
                void this._CloseEditorScene(documentId),
        });
        this._isMounted = true;
        this._exportButton.addEventListener("click", this._onExportClick);
        this._importButton.addEventListener("click", this._onImportClick);
        this._importFileInput.addEventListener(
            "change",
            this._onImportFileChange,
        );
        this._unsavedCloseDialog?.addEventListener(
            "click",
            this._onUnsavedCloseDialogClick,
        );
        this._unsubscribeWorkspace = this._workspace.Subscribe(
            this._onWorkspaceChange,
        );
    }

    async OpenAssetScene(url, relativePath) {
        if (this._isDisposed) {
            return;
        }

        try {
            await this._workspace.OpenAssetScene(url, relativePath);
        } catch (error) {
            this._SetDocumentMessage(
                "Could not open scene: " + GetErrorMessage(error),
            );
            this._LogError("Editor scene asset failed to open.", error);
        }
    }

    Dispose() {
        if (this._isDisposed) {
            return;
        }

        this._isDisposed = true;
        this._unsubscribeWorkspace?.();
        this._unsubscribeWorkspace = null;
        this._sceneTabs?.Dispose();
        this._sceneTabs = null;
        this._exportButton.removeEventListener(
            "click",
            this._onExportClick,
        );
        this._importButton.removeEventListener(
            "click",
            this._onImportClick,
        );
        this._importFileInput.removeEventListener(
            "change",
            this._onImportFileChange,
        );
        this._unsavedCloseDialog?.removeEventListener(
            "click",
            this._onUnsavedCloseDialogClick,
        );
    }

    _UpdateEditorDocumentStatus() {
        const activeDocument = this._workspace.ActiveDocument ?? null;
        this._exportButton.disabled = !activeDocument;
        this._importButton.disabled = !this._isMounted || this._isDisposed;

        if (this._documentStatus) {
            if (!activeDocument) {
                this._documentStatus.textContent =
                    "Editor document · No scene";
            } else {
                const documentState =
                    activeDocument.documentSession.IsDirty
                        ? "Unsaved changes"
                        : "Saved";
                this._documentStatus.textContent =
                    activeDocument.title + " · " + documentState;
            }
        }

        this._sceneTabs?.Render(this._workspace.GetSnapshot());
        if (this._emptySceneState) {
            this._emptySceneState.hidden = Boolean(activeDocument);
        }
        if (this._status) {
            this._status.textContent = activeDocument
                ? "Scene loaded. WebGPU ready."
                : "No scene open. WebGPU ready.";
        }
    }

    _OpenEditorScenePicker() {
        this._importFileInput.click();
    }

    async _LoadImportedEditorScene(data, fileName) {
        this._SetDocumentMessage(
            "Editor document · Importing " + fileName,
        );
        try {
            await this._workspace.OpenImportedScene(data, fileName);
        } catch (error) {
            this._SetDocumentMessage(
                "Editor import failed: " + GetErrorMessage(error),
            );
            this._LogError("Editor scene import failed.", error);
        }
    }

    async _ImportEditorSceneFile() {
        const file = this._importFileInput.files?.[0];
        if (!file || this._isDisposed) {
            return;
        }

        this._importButton.disabled = true;
        try {
            const data = JsonFormat.Parse(await file.text());
            await this._LoadImportedEditorScene(data, file.name);
        } catch (error) {
            this._SetDocumentMessage(
                "Editor import failed: " + GetErrorMessage(error),
            );
            this._LogError("Editor scene import failed.", error);
        } finally {
            this._importFileInput.value = "";
            this._importButton.disabled = this._isDisposed;
        }
    }

    _DownloadActiveScene() {
        return this._DownloadSceneDocument(
            this._workspace.ActiveDocument,
        );
    }

    _DownloadSceneDocument(documentRecord) {
        if (!documentRecord) {
            return false;
        }

        const scene = documentRecord.sceneSession.Scene;
        try {
            const documentData = this._documentAdapter.Serialize(scene);
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
            documentRecord.documentSession.MarkExported(scene);
            return true;
        } catch (error) {
            this._SetDocumentMessage(
                "Editor export failed: " + GetErrorMessage(error),
            );
            this._LogError("Editor scene export failed.", error);
            return false;
        }
    }

    _ChooseUnsavedCloseAction(documentRecord) {
        if (
            !this._unsavedCloseDialog ||
            typeof this._unsavedCloseDialog.showModal !== "function"
        ) {
            return Promise.resolve("cancel");
        }

        this._unsavedCloseMessage.textContent =
            documentRecord.title +
            " has unsaved changes. Export Copy downloads a JSON copy. It does not overwrite the project asset.";
        return new Promise((resolve) => {
            this._unsavedCloseDialog.addEventListener(
                "close",
                () =>
                    resolve(
                        this._unsavedCloseDialog.returnValue || "cancel",
                    ),
                { once: true },
            );
            this._unsavedCloseDialog.showModal();
        });
    }

    _HandleUnsavedCloseDialogClick(event) {
        if (!this._unsavedCloseDialog) {
            return;
        }

        const button = event.target.closest("[data-unsaved-action]");
        if (!button || !this._unsavedCloseDialog.contains(button)) {
            return;
        }
        this._unsavedCloseDialog.close(button.dataset.unsavedAction);
    }

    async _CloseEditorScene(documentId) {
        if (!this._canChangeScene()) {
            return;
        }

        const documentRecord = this._workspace.GetDocument(documentId);
        if (!documentRecord) {
            return;
        }

        let discardChanges = false;
        if (documentRecord.documentSession.IsDirty) {
            const action =
                await this._ChooseUnsavedCloseAction(documentRecord);
            if (action === "cancel") {
                return;
            }
            if (
                action === "export" &&
                !this._DownloadSceneDocument(documentRecord)
            ) {
                return;
            }
            discardChanges = action === "discard";
        }

        try {
            this._workspace.CloseDocument(documentId, { discardChanges });
        } catch (error) {
            this._SetDocumentMessage(GetErrorMessage(error));
            this._LogError("Editor scene tab failed to close.", error);
        }
    }

    _ActivateEditorScene(documentId) {
        if (!this._canChangeScene()) {
            return;
        }

        try {
            this._workspace.ActivateDocument(documentId);
        } catch (error) {
            this._SetDocumentMessage(GetErrorMessage(error));
            this._LogError("Editor scene tab failed to activate.", error);
        }
    }

    _SetDocumentMessage(message) {
        if (this._documentStatus) {
            this._documentStatus.textContent = message;
        }
    }

    _LogError(message, error) {
        this._logger.Error(message, error);
    }
}
