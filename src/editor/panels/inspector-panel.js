import { CreateElement } from "../ui/dom-utils.js";
import { EditorCommandHistory } from "../editor-command-history.js";
import { InspectorEditController } from "./inspector/edit-controller.js";
import {
    CreateField,
    CreateFieldError,
} from "./inspector/field-controls.js";
import { GetComponentEnabledKey } from "./inspector/field-ids.js";
import { CreateInspectorComponentRegistry } from "./inspector/component-registry.js";

const REFRESH_INTERVAL_MS = 250;

function ValidateDependencies(
    sceneManager,
    selection,
    rootElement,
    getAssetCatalog,
    commandHistory,
    componentCatalog,
    authoringController,
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
}

export class InspectorPanel {
    constructor(
        sceneManager,
        selection,
        rootElement,
        componentRegistry = null,
        getAssetCatalog = null,
        commandHistory = null,
        componentCatalog,
        authoringController,
    ) {
        ValidateDependencies(
            sceneManager,
            selection,
            rootElement,
            getAssetCatalog,
            commandHistory,
            componentCatalog,
            authoringController,
        );

        this._sceneManager = sceneManager;
        this._selection = selection;
        this._root = rootElement;
        this._getAssetCatalog = getAssetCatalog;
        this._history = commandHistory ?? new EditorCommandHistory();
        this._componentRegistry =
            componentRegistry ?? CreateInspectorComponentRegistry();
        this._componentCatalog = componentCatalog;
        this._authoringController = authoringController;
        this._componentTypesByKey = new Map();
        this._refreshTimer = null;
        this._lastScene = null;
        this._lastEntityId = null;
        this._lastStructuralRevision = null;
        this._editController = new InspectorEditController({
            sceneManager,
            selection,
            history: this._history,
            componentRegistry: this._componentRegistry,
            getAssetCatalog,
            componentTypesByKey: this._componentTypesByKey,
            onPendingChange: () => this._UpdateHistoryControls(),
        });
        this._onChange = (event) => void this._HandleChange(event);
        this._onHistoryClick = (event) => this._HandleHistoryClick(event);
        this._onAuthoringClick = (event) =>
            void this._HandleAuthoringClick(event);

        this._MountView();
        this._SubscribeToChanges();
    }

    Dispose() {
        if (this._refreshTimer !== null) {
            globalThis.clearInterval(this._refreshTimer);
            this._refreshTimer = null;
        }

        this._root.removeEventListener("change", this._onChange);
        this._root.removeEventListener("click", this._onHistoryClick);
        this._root.removeEventListener("click", this._onAuthoringClick);
        this._unsubscribeSelection?.();
        this._unsubscribeSelection = null;
        this._unsubscribeHistory?.();
        this._unsubscribeHistory = null;
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
        this._unsubscribeSelection = this._selection.Subscribe(() =>
            this._Refresh(true),
        );
        this._unsubscribeHistory = this._history.Subscribe(() =>
            this._UpdateHistoryControls(),
        );
        this._Refresh(true);
        this._refreshTimer = globalThis.setInterval(
            () => this._Refresh(),
            REFRESH_INTERVAL_MS,
        );
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
        this._componentTypesByKey.clear();
        const entityManager = scene.EntityManager;
        const entityFields = this._root.querySelector(
            '[data-role="entity-fields"]',
        );
        const componentRoot = this._root.querySelector(
            '[data-role="components"]',
        );
        const authoringRoot = this._root.querySelector(
            '[data-role="component-authoring"]',
        );
        entityFields.replaceChildren();
        componentRoot.replaceChildren();
        authoringRoot.replaceChildren();

        this._RenderEntityFields(entityManager, entityId, entityFields);
        this._RenderComponentAuthoring(
            entityManager,
            entityId,
            authoringRoot,
        );
        this._RenderComponentSections(scene, entityId, componentRoot);
    }

    _RenderEntityFields(entityManager, entityId, container) {
        CreateField(
            container,
            "Name",
            "entity.name",
            entityManager.GetEntityName(entityId),
            "text",
        );
        this._CreateCheckbox(
            container,
            "Active",
            "entity.active",
            entityManager.IsEntityActive(entityId),
        );
    }

    _RenderComponentAuthoring(entityManager, entityId, container) {
        const definitions = this._componentCatalog.GetAddable(
            entityManager,
            entityId,
        );
        const label = CreateElement("label", "inspector-component-add");
        const caption = document.createElement("span");
        caption.textContent = "Add component";
        const select = document.createElement("select");
        select.dataset.role = "component-type";

        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = definitions.length > 0
            ? "Choose a component"
            : "No components available";
        select.append(placeholder);

        for (const definition of definitions) {
            const option = document.createElement("option");
            option.value = definition.typeId;
            option.textContent = definition.title;
            select.append(option);
        }

        label.append(caption, select);
        const fields = CreateElement(
            "div",
            "inspector-component-create-fields",
        );
        fields.dataset.role = "component-create-fields";
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.authoringAction = "add-component";
        button.textContent = "Add";
        button.disabled = true;

        const status = CreateElement("span", "inspector-authoring-status");
        status.dataset.role = "authoring-status";
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        container.append(label, fields, button, status);
        this._UpdateAuthoringControls();
    }

    _RenderComponentCreationFields(typeId, container) {
        container.replaceChildren();
        const definition = this._componentCatalog.GetById(typeId);
        try {
            definition?.renderAddFields?.(container, {
                getAssetCatalog: this._getAssetCatalog,
            });
        } catch (error) {
            const status = this._root.querySelector(
                '[data-role="authoring-status"]',
            );
            status.textContent = this._GetErrorMessage(error);
        }
    }

    _UpdateAuthoringControls() {
        const typeSelect = this._root.querySelector(
            '[data-role="component-type"]',
        );
        const addButton = this._root.querySelector(
            '[data-authoring-action="add-component"]',
        );
        if (!typeSelect || !addButton) {
            return;
        }

        const requiredFields = this._root.querySelectorAll(
            "[data-component-create-field][required]",
        );
        addButton.disabled =
            !typeSelect.value ||
            [...requiredFields].some((field) => field.value === "") ||
            this._editController.IsBusy ||
            this._authoringController.IsBusy;
    }

    _RenderComponentSections(scene, entityId, container) {
        const entityManager = scene.EntityManager;
        const components = entityManager.GetComponentEntries(entityId);
        components.forEach(({ componentType, component }, index) =>
            this._RenderComponentSection(
                scene,
                entityId,
                container,
                componentType,
                component,
                index,
            ),
        );

        if (components.length === 0) {
            const empty = CreateElement("div", "inspector-empty-components");
            empty.textContent = "This entity has no components.";
            container.append(empty);
        }
    }

    _RenderComponentSection(
        scene,
        entityId,
        container,
        componentType,
        component,
        componentIndex,
    ) {
        const componentKey = `component-${componentIndex}`;
        this._componentTypesByKey.set(componentKey, componentType);
        const definition = this._componentRegistry.Get(componentType);
        const entityManager = scene.EntityManager;
        const section = CreateElement("section", "inspector-component");
        section.dataset.componentKey = componentKey;
        this._RenderComponentHeader(
            section,
            componentKey,
            componentType,
            definition,
            entityManager,
            entityId,
            scene,
        );

        const body = CreateElement("div", "inspector-component-body");
        section.append(body);
        container.append(section);
        definition?.render?.(
            body,
            this._CreateComponentContext(
                scene,
                entityId,
                componentType,
                component,
            ),
        );
    }

    _RenderComponentHeader(
        section,
        componentKey,
        componentType,
        definition,
        entityManager,
        entityId,
        scene,
    ) {
        const header = CreateElement("header", "inspector-component-header");
        const heading = document.createElement("h3");
        heading.textContent = definition?.title ?? componentType.name;
        header.append(heading);

        const authoringDefinition =
            this._componentCatalog.GetByType(componentType);
        if (
            authoringDefinition &&
            authoringDefinition.canRemove !== false
        ) {
            const removeButton = document.createElement("button");
            removeButton.type = "button";
            removeButton.className = "inspector-component-remove";
            removeButton.dataset.authoringAction = "remove-component";
            removeButton.dataset.componentTypeId = authoringDefinition.typeId;
            removeButton.textContent = "Remove";
            removeButton.disabled = !this._componentCatalog.CanRemove(
                componentType,
                { scene, entityId },
            );
            if (removeButton.disabled) {
                removeButton.title =
                    "Removal is not available for this component in its current state.";
            }
            header.append(removeButton);
        }

        const canDisable =
            componentType.CanBeDisabled !== false &&
            definition?.canDisable !== false;
        if (!canDisable) {
            const required = CreateElement("span", "inspector-required");
            required.textContent = "Required";
            header.append(required);
        } else {
            const toggle = this._CreateCheckbox(
                header,
                "Enabled",
                `component.enabled.${componentKey}`,
                entityManager.IsComponentEnabled(entityId, componentType),
            );
            toggle.dataset.componentKey = componentKey;
            toggle.disabled = this._IsEnabledToggleDisabled(
                scene,
                entityId,
                componentType,
                definition,
            );
        }

        section.append(header);
    }

    _CreateComponentContext(scene, entityId, componentType, component) {
        return {
            scene,
            entityId,
            entityManager: scene.EntityManager,
            componentType,
            component,
            assetAccess: this._editController.AssetAccess,
        };
    }

    _CreateCheckbox(container, labelText, fieldId, checked) {
        const label = CreateElement("label", "inspector-checkbox");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = checked;
        input.dataset.inspectorField = fieldId;
        const caption = document.createElement("span");
        caption.textContent = labelText;
        label.append(input, caption, CreateFieldError(fieldId));
        container.append(label);
        return input;
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
            this._SetFieldError(fieldId, "");
            this._ClearHistoryStatus();
            if (result.refresh && input.isConnected) {
                this._Refresh(true);
            }
        } catch (error) {
            this._editController.RestoreRejectedInput(
                selection.scene,
                selection.entityId,
                input,
                fieldId,
            );
            this._SetFieldError(fieldId, this._GetErrorMessage(error));
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
        const { valuesByField, componentEnabledByKey } =
            this._CollectInspectorValues(scene, entityId);
        this._ApplySyncedValues(scene, entityId, valuesByField, componentEnabledByKey);
    }

    _CollectInspectorValues(scene, entityId) {
        const entityManager = scene.EntityManager;
        const valuesByField = new Map([
            ["entity.name", entityManager.GetEntityName(entityId)],
            ["entity.active", entityManager.IsEntityActive(entityId)],
        ]);
        const componentEnabledByKey = new Map();

        for (const [componentKey, componentType] of this._componentTypesByKey) {
            componentEnabledByKey.set(
                componentKey,
                entityManager.IsComponentEnabled(entityId, componentType),
            );
            this._SyncComponentValues(
                scene,
                entityId,
                componentType,
                entityManager.GetComponent(entityId, componentType),
                valuesByField,
            );
        }

        return { valuesByField, componentEnabledByKey };
    }

    _SyncComponentValues(scene, entityId, componentType, component, valuesByField) {
        const values = this._componentRegistry.Get(componentType)?.sync?.(
            this._CreateComponentContext(scene, entityId, componentType, component),
        );
        if (values instanceof Map) {
            for (const [fieldId, value] of values) {
                valuesByField.set(fieldId, value);
            }
        } else if (values && typeof values === "object" && !Array.isArray(values)) {
            for (const [fieldId, value] of Object.entries(values)) {
                valuesByField.set(fieldId, value);
            }
        }
    }

    _ApplySyncedValues(scene, entityId, valuesByField, componentEnabledByKey) {
        this._SyncConditionalGroups(valuesByField);
        this._SyncInputs(
            scene,
            entityId,
            valuesByField,
            componentEnabledByKey,
        );
    }

    _SyncConditionalGroups(valuesByField) {
        for (const group of this._root.querySelectorAll(
            "[data-inspector-condition-field]",
        )) {
            const fieldId = group.dataset.inspectorConditionField;
            group.hidden =
                valuesByField.get(fieldId) !==
                group.dataset.inspectorConditionValue;
        }
    }

    _SyncInputs(scene, entityId, valuesByField, componentEnabledByKey) {
        for (const input of this._root.querySelectorAll(
            "[data-inspector-field]",
        )) {
            const fieldId = input.dataset.inspectorField;
            const componentKey = GetComponentEnabledKey(fieldId);
            if (componentKey !== null) {
                input.checked = componentEnabledByKey.get(componentKey) ?? false;
                this._UpdateEnabledToggle(input, componentKey, scene, entityId);
                continue;
            }
            this._SyncInputValue(input, fieldId, valuesByField);
        }
    }

    _UpdateEnabledToggle(input, componentKey, scene, entityId) {
        const componentType = this._componentTypesByKey.get(componentKey);
        const definition = componentType
            ? this._componentRegistry.Get(componentType)
            : null;
        input.disabled = this._IsEnabledToggleDisabled(
            scene,
            entityId,
            componentType,
            definition,
        );
    }

    _IsEnabledToggleDisabled(scene, entityId, componentType, definition) {
        return Boolean(
            definition?.isEnabledToggleDisabled?.({
                scene,
                entityId,
                componentType,
            }),
        );
    }

    _SyncInputValue(input, fieldId, valuesByField) {
        if (
            document.activeElement === input ||
            input.getAttribute("aria-invalid") === "true" ||
            !valuesByField.has(fieldId)
        ) {
            return;
        }

        const value = valuesByField.get(fieldId);
        if (input.type === "checkbox") {
            input.checked = value;
        } else {
            input.value = String(value);
        }
    }

    _GetErrorMessage(error) {
        return error instanceof Error ? error.message : String(error);
    }
}
