import { EditorCommandHistory } from "../../editor-command-history.js";
import { InspectorEditController } from "./edit-controller.js";
import { InspectorComponentView } from "./component-view.js";

const REFRESH_INTERVAL_MS = 250;

function ValidateDependencies(
    sceneManager,
    selection,
    rootElement,
    getAssetCatalog,
    commandHistory,
    componentCatalog,
    authoringController,
    assetTracker,
) {
    if (
        !sceneManager ||
        typeof sceneManager.LoadScene !== "function" ||
        typeof sceneManager.FixedUpdate !== "function"
    ) {
        throw new TypeError("InspectorPanel requires a scene manager.");
    }
    if (
        !selection ||
        typeof selection.Subscribe !== "function" ||
        typeof selection.Clear !== "function"
    ) {
        throw new TypeError("InspectorPanel requires editor selection.");
    }
    if (!(rootElement instanceof HTMLElement)) {
        throw new TypeError("InspectorPanel requires a content element.");
    }
    if (
        getAssetCatalog !== null &&
        typeof getAssetCatalog !== "function"
    ) {
        throw new TypeError("InspectorPanel asset catalog must be a function.");
    }
    if (
        commandHistory !== null &&
        (typeof commandHistory.SetScene !== "function" ||
            typeof commandHistory.RecordApplied !== "function" ||
            typeof commandHistory.Undo !== "function" ||
            typeof commandHistory.Redo !== "function" ||
            typeof commandHistory.Subscribe !== "function")
    ) {
        throw new TypeError("InspectorPanel requires editor command history.");
    }
    if (
        !componentCatalog ||
        typeof componentCatalog.GetAddable !== "function" ||
        typeof componentCatalog.GetById !== "function" ||
        typeof componentCatalog.GetByType !== "function" ||
        typeof componentCatalog.GetInspectorByType !== "function" ||
        typeof componentCatalog.GetAssetIds !== "function" ||
        typeof componentCatalog.CanRemove !== "function"
    ) {
        throw new TypeError("InspectorPanel requires component authoring data.");
    }
    if (
        !authoringController ||
        typeof authoringController.AddComponent !== "function" ||
        typeof authoringController.RemoveComponent !== "function" ||
        typeof authoringController.DeleteEntity !== "function"
    ) {
        throw new TypeError("InspectorPanel requires scene authoring.");
    }
    if (assetTracker !== null && typeof assetTracker.Refresh !== "function") {
        throw new TypeError("InspectorPanel asset tracker must support refresh.");
    }
}

export class InspectorPanel {
    constructor(
        sceneManager,
        selection,
        rootElement,
        getAssetCatalog = null,
        commandHistory = null,
        componentCatalog,
        authoringController,
        assetTracker = null,
    ) {
        ValidateDependencies(
            sceneManager,
            selection,
            rootElement,
            getAssetCatalog,
            commandHistory,
            componentCatalog,
            authoringController,
            assetTracker,
        );

        this._sceneManager = sceneManager;
        this._selection = selection;
        this._root = rootElement;
        this._getAssetCatalog = getAssetCatalog;
        this._history = commandHistory ?? new EditorCommandHistory();
        this._componentCatalog = componentCatalog;
        this._authoringController = authoringController;
        this._assetTracker = assetTracker;
        this._componentTypesByKey = new Map();
        this._refreshTimer = null;
        this._isVisible = true;
        this._lastScene = null;
        this._lastEntityId = null;
        this._lastStructuralRevision = null;
        this._editController = new InspectorEditController({
            sceneManager,
            selection,
            history: this._history,
            componentCatalog: this._componentCatalog,
            getAssetCatalog,
            componentTypesByKey: this._componentTypesByKey,
            onPendingChange: (delta, pendingEditCount) => {
                this._UpdateHistoryControls();
                this._assetTracker?.Refresh({
                    force: delta < 0 && pendingEditCount === 0,
                });
            },
        });
        this._componentView = new InspectorComponentView({
            root: this._root,
            componentCatalog: this._componentCatalog,
            getAssetCatalog: this._getAssetCatalog,
            assetAccess: this._editController.AssetAccess,
            componentTypesByKey: this._componentTypesByKey,
            isBusy: () =>
                this._editController.IsBusy || this._authoringController.IsBusy,
        });
        this._onChange = (event) => void this._HandleChange(event);
        this._onHistoryClick = (event) => this._HandleHistoryClick(event);
        this._onAuthoringClick = (event) =>
            void this._HandleAuthoringClick(event);

        this._MountView();
        this._SubscribeToChanges();
    }

    Dispose() {
        this._isVisible = false;
        this._StopRefreshTimer();

        this._root.removeEventListener("change", this._onChange);
        this._root.removeEventListener("click", this._onHistoryClick);
        this._root.removeEventListener("click", this._onAuthoringClick);
        this._unsubscribeSelection?.();
        this._unsubscribeSelection = null;
        this._unsubscribeHistory?.();
        this._unsubscribeHistory = null;
    }

    OnHide() {
        this._isVisible = false;
        this._StopRefreshTimer();
    }

    OnShow() {
        if (this._isVisible) {
            return;
        }

        this._isVisible = true;
        this._Refresh(true);
        this._StartRefreshTimer();
    }

    _StartRefreshTimer() {
        if (this._refreshTimer !== null) {
            return;
        }

        this._refreshTimer = globalThis.setInterval(
            () => this._Refresh(),
            REFRESH_INTERVAL_MS,
        );
    }

    _StopRefreshTimer() {
        if (this._refreshTimer === null) {
            return;
        }

        globalThis.clearInterval(this._refreshTimer);
        this._refreshTimer = null;
    }

    _MountView() {
        this._root.classList.add("inspector-panel");
        this._root.innerHTML = `
            <div class="inspector-history" role="toolbar" aria-label="Inspector history">
                <button type="button" data-history-action="undo" disabled>Undo</button>
                <button type="button" data-history-action="redo" disabled>Redo</button>
                <span data-role="history-status" role="status" aria-live="polite"></span>
            </div>
            <div class="inspector-empty" data-role="empty" role="status">
                Select an entity to inspect it.
            </div>
            <div class="inspector-content" data-role="content" hidden>
                <section class="inspector-entity">
                    <header class="inspector-entity-header">
                        <h3>Entity</h3>
                    </header>
                    <div data-role="entity-fields"></div>
                </section>
                <div class="inspector-component-authoring" data-role="component-authoring"></div>
                <div class="inspector-components" data-role="components"></div>
                <div class="inspector-entity-actions">
                    <button
                        type="button"
                        class="inspector-entity-delete"
                        data-authoring-action="delete-entity"
                        disabled
                        title="Delete the selected entity hierarchy"
                    >Delete Entity</button>
                </div>
            </div>`;
    }

    _SubscribeToChanges() {
        this._root.addEventListener("change", this._onChange);
        this._root.addEventListener("click", this._onHistoryClick);
        this._root.addEventListener("click", this._onAuthoringClick);
        this._unsubscribeSelection = this._selection.Subscribe(() => {
            if (this._isVisible) {
                this._Refresh(true);
            }
        });
        this._unsubscribeHistory = this._history.Subscribe(() =>
            this._UpdateHistoryControls(),
        );
        this._Refresh(true);
        this._StartRefreshTimer();
    }

    _GetCurrentSelection() {
        const selection = this._selection.Current;
        const scene = this._sceneManager.ActiveScene;
        if (!selection || selection.scene !== scene) {
            return null;
        }

        try {
            scene.EntityManager.GetEntityName(selection.entityId);
            return selection;
        } catch {
            this._selection.Clear();
            return null;
        }
    }

    _Refresh(forceRebuild = false) {
        this._history.SetScene(this._sceneManager.ActiveScene);
        const selection = this._GetCurrentSelection();
        const empty = this._root.querySelector('[data-role="empty"]');
        const content = this._root.querySelector('[data-role="content"]');

        if (!selection) {
            this._ShowEmptyState(empty, content);
            return;
        }

        const { scene, entityId } = selection;
        const entityManager = scene.EntityManager;
        const shouldRebuild =
            forceRebuild ||
            this._lastScene !== scene ||
            this._lastEntityId !== entityId ||
            this._lastStructuralRevision !== entityManager.StructuralRevision;

        if (shouldRebuild) {
            this._BuildInspector(scene, entityId);
        }

        this._lastScene = scene;
        this._lastEntityId = entityId;
        this._lastStructuralRevision = entityManager.StructuralRevision;
        empty.hidden = true;
        content.hidden = false;
        this._SyncValues(scene, entityId);
        this._UpdateHistoryControls();
    }

    _ShowEmptyState(empty, content) {
        empty.hidden = false;
        content.hidden = true;
        this._lastScene = null;
        this._lastEntityId = null;
        this._lastStructuralRevision = null;
        this._UpdateHistoryControls();
    }

    _HandleHistoryClick(event) {
        const button = event.target.closest("[data-history-action]");
        if (!button || !this._root.contains(button)) {
            return;
        }
        void this._RunHistoryAction(button.dataset.historyAction);
    }

    async _HandleAuthoringClick(event) {
        const button = event.target.closest("[data-authoring-action]");
        if (!button || !this._root.contains(button)) {
            return;
        }
        if (this._editController.IsBusy || this._authoringController.IsBusy) {
            return;
        }

        const selection = this._GetCurrentSelection();
        if (!selection) {
            return;
        }

        const status = this._root.querySelector(
            '[data-role="authoring-status"]',
        );
        status.textContent = "";
        try {
            if (button.dataset.authoringAction === "add-component") {
                const typeId = this._root.querySelector(
                    '[data-role="component-type"]',
                ).value;
                if (!typeId) {
                    return;
                }
                const values = Object.fromEntries(
                    [...this._root.querySelectorAll(
                        "[data-component-create-field]",
                    )].map((field) => [
                        field.dataset.componentCreateField,
                        field.value,
                    ]),
                );
                const addOperation = this._authoringController.AddComponent(
                    selection.scene,
                    selection.entityId,
                    typeId,
                    values,
                );
                this._UpdateHistoryControls();
                await addOperation;
            } else if (button.dataset.authoringAction === "remove-component") {
                this._authoringController.RemoveComponent(
                    selection.scene,
                    selection.entityId,
                    button.dataset.componentTypeId,
                );
            } else if (button.dataset.authoringAction === "delete-entity") {
                this._authoringController.DeleteEntity(
                    selection.scene,
                    selection.entityId,
                );
            } else {
                return;
            }
            this._Refresh(true);
        } catch (error) {
            status.textContent = this._GetErrorMessage(error);
        } finally {
            this._UpdateHistoryControls();
        }
    }

    async _RunHistoryAction(action) {
        if (
            this._editController.IsBusy ||
            this._authoringController.IsBusy
        ) {
            return;
        }

        this._history.SetScene(this._sceneManager.ActiveScene);
        const status = this._root.querySelector(
            '[data-role="history-status"]',
        );
        status.textContent = "";

        try {
            if (action === "undo") {
                await this._history.Undo();
            } else if (action === "redo") {
                await this._history.Redo();
            } else {
                return;
            }
            this._Refresh();
        } catch (error) {
            status.textContent = this._GetErrorMessage(error);
        }
    }

    _UpdateHistoryControls() {
        const undoButton = this._root.querySelector(
            '[data-history-action="undo"]',
        );
        const redoButton = this._root.querySelector(
            '[data-history-action="redo"]',
        );
        const content = this._root.querySelector('[data-role="content"]');
        const isBusy =
            this._editController.IsBusy || this._authoringController.IsBusy;
        const selection = this._selection.Current;
        const activeScene = this._sceneManager.ActiveScene;
        let hasCurrentSelection = selection?.scene === activeScene;
        if (hasCurrentSelection) {
            try {
                activeScene.EntityManager.GetEntityName(selection.entityId);
            } catch {
                hasCurrentSelection = false;
            }
        }

        undoButton.disabled = isBusy || !this._history.CanUndo;
        redoButton.disabled = isBusy || !this._history.CanRedo;
        undoButton.title = this._history.UndoLabel
            ? `Undo ${this._history.UndoLabel}`
            : "Nothing to undo";
        redoButton.title = this._history.RedoLabel
            ? `Redo ${this._history.RedoLabel}`
            : "Nothing to redo";
        content.inert = isBusy;
        const deleteButton = this._root.querySelector(
            '[data-authoring-action="delete-entity"]',
        );
        deleteButton.disabled = isBusy || !hasCurrentSelection;
    }

    _BuildInspector(scene, entityId) {
        this._componentView.Build(scene, entityId);
    }

    _RenderComponentCreationFields(typeId, container) {
        this._componentView.RenderCreationFields(typeId, container);
    }

    _UpdateAuthoringControls() {
        this._componentView.UpdateAuthoringControls();
    }

    async _HandleChange(event) {
        const componentSelect = event.target.closest(
            '[data-role="component-type"]',
        );
        if (componentSelect && this._root.contains(componentSelect)) {
            const fields = this._root.querySelector(
                '[data-role="component-create-fields"]',
            );
            this._RenderComponentCreationFields(
                componentSelect.value,
                fields,
            );
            this._UpdateAuthoringControls();
            return;
        }

        const componentCreateField = event.target.closest(
            "[data-component-create-field]",
        );
        if (
            componentCreateField &&
            this._root.contains(componentCreateField)
        ) {
            this._UpdateAuthoringControls();
            return;
        }

        const input = event.target.closest("[data-inspector-field]");
        if (
            !input ||
            !this._root.contains(input) ||
            this._editController.IsBusy
        ) {
            return;
        }

        const selection = this._GetCurrentSelection();
        if (!selection) {
            return;
        }

        const fieldId = input.dataset.inspectorField;
        try {
            const result = await this._editController.ApplyInput(
                selection.scene,
                selection.entityId,
                input,
            );
            if (input.isConnected) {
                this._SetFieldError(fieldId, "");
                this._ClearHistoryStatus();
                if (result.refresh) {
                    this._Refresh(true);
                }
            }
        } catch (error) {
            this._editController.RestoreRejectedInput(
                selection.scene,
                selection.entityId,
                input,
                fieldId,
            );
            if (input.isConnected) {
                this._SetFieldError(fieldId, this._GetErrorMessage(error));
            }
        }
    }

    _ClearHistoryStatus() {
        this._root.querySelector(
            '[data-role="history-status"]',
        ).textContent = "";
    }

    _SetFieldError(fieldId, message) {
        for (const element of this._root.querySelectorAll(
            "[data-inspector-field], [data-error-for]",
        )) {
            if (element.dataset.inspectorField === fieldId) {
                if (message) {
                    element.setAttribute("aria-invalid", "true");
                } else {
                    element.removeAttribute("aria-invalid");
                }
            }
            if (element.dataset.errorFor === fieldId) {
                element.textContent = message;
            }
        }
    }

    _SyncValues(scene, entityId) {
        this._componentView.SyncValues(scene, entityId);
    }

    _GetErrorMessage(error) {
        return error instanceof Error ? error.message : String(error);
    }
}
