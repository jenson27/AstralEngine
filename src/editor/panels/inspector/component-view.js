import { CreateElement } from "../../ui/dom-utils.js";
import { AstralLogger } from "../../../diagnostics/logger.js";
import {
    CreateField,
    CreateFieldError,
} from "./field-controls.js";
import { GetComponentEnabledKey } from "./field-ids.js";

export class InspectorComponentView {
    constructor({
        root,
        componentCatalog,
        getAssetMetadata,
        assetAccess,
        componentTypesByKey,
        isBusy,
    }) {
        this._root = root;
        this._componentCatalog = componentCatalog;
        this._getAssetMetadata = getAssetMetadata;
        this._assetAccess = assetAccess;
        this._componentTypesByKey = componentTypesByKey;
        this._isBusy = isBusy;
        this._reportedInspectorErrors = new Set();
    }

    Build(scene, entityId) {
        this._BuildInspector(scene, entityId);
    }

    RenderCreationFields(typeId, container) {
        this._RenderComponentCreationFields(typeId, container);
    }

    UpdateAuthoringControls() {
        this._UpdateAuthoringControls();
    }

    SyncValues(scene, entityId) {
        this._SyncValues(scene, entityId);
    }

    _BuildInspector(scene, entityId) {
        this._componentTypesByKey.clear();
        this._reportedInspectorErrors.clear();
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
                getAssetMetadata: this._getAssetMetadata,
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
            this._isBusy();
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
        const definition = this._componentCatalog.GetInspectorByType(componentType);
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
        try {
            definition?.render?.(
                body,
                this._CreateComponentContext(
                    scene,
                    entityId,
                    componentType,
                    component,
                ),
            );
        } catch (error) {
            this._SetComponentInspectorError(
                section,
                componentKey,
                componentType,
                "render",
                error,
            );
        }
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
            assetAccess: this._assetAccess,
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
                componentKey,
                componentType,
                entityManager.GetComponent(entityId, componentType),
                valuesByField,
            );
        }

        return { valuesByField, componentEnabledByKey };
    }

    _SyncComponentValues(
        scene,
        entityId,
        componentKey,
        componentType,
        component,
        valuesByField,
    ) {
        let values;
        try {
            values = this._componentCatalog
                .GetInspectorByType(componentType)
                ?.sync?.(
                    this._CreateComponentContext(
                        scene,
                        entityId,
                        componentType,
                        component,
                    ),
                );
            this._ClearComponentInspectorError(componentKey, "sync");
        } catch (error) {
            this._SetComponentInspectorError(
                this._GetComponentSection(componentKey),
                componentKey,
                componentType,
                "sync",
                error,
            );
            return;
        }

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

    _GetComponentSection(componentKey) {
        return [...this._root.querySelectorAll("[data-component-key]")].find(
            (section) => section.dataset.componentKey === componentKey,
        );
    }

    _SetComponentInspectorError(
        section,
        componentKey,
        componentType,
        phase,
        error,
    ) {
        if (!section) {
            return;
        }

        const errorKey = `${componentKey}:${phase}`;
        if (!this._reportedInspectorErrors.has(errorKey)) {
            AstralLogger.Error(
                `Inspector ${phase} failed for component "${componentType.name}".`,
                error,
            );
            this._reportedInspectorErrors.add(errorKey);
        }

        let errorElement = section.querySelector(
            `[data-inspector-error="${phase}"]`,
        );
        if (!errorElement) {
            errorElement = CreateElement("div", "inspector-component-error");
            errorElement.dataset.inspectorError = phase;
            errorElement.setAttribute("role", "alert");
            section.append(errorElement);
        }

        errorElement.textContent =
            `Unable to ${phase} ${componentType.name} inspector.`;
    }

    _ClearComponentInspectorError(componentKey, phase) {
        if (!this._reportedInspectorErrors.delete(`${componentKey}:${phase}`)) {
            return;
        }

        this._GetComponentSection(componentKey)
            ?.querySelector(`[data-inspector-error="${phase}"]`)
            ?.remove();
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
            ? this._componentCatalog.GetInspectorByType(componentType)
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
