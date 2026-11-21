import { AreDataValuesEqual } from "./component-value-utils.js";
import { InspectorAssetAccess } from "./asset-access.js";
import { GetComponentEnabledKey } from "./field-ids.js";

const BUILT_IN_EDIT_HANDLERS = new Map([
    [
        "entity.name",
        {
            capture: ({ entityManager, entityId }) =>
                entityManager.GetEntityName(entityId),
            apply: ({ entityManager, entityId, value }) =>
                entityManager.SetEntityName(entityId, value),
        },
    ],
    [
        "entity.active",
        {
            capture: ({ entityManager, entityId }) =>
                entityManager.IsEntityActive(entityId),
            apply: ({ scene, entityId, value }) =>
                scene.SetEntityActive(entityId, value),
        },
    ],
]);

export class InspectorEditController {
    constructor({
        sceneManager,
        selection,
        history,
        componentRegistry,
        getAssetCatalog,
        componentTypesByKey = new Map(),
        onPendingChange = () => {},
    }) {
        this._sceneManager = sceneManager;
        this._selection = selection;
        this._history = history;
        this._componentRegistry = componentRegistry;
        this._assetAccess = new InspectorAssetAccess(
            sceneManager,
            selection,
            getAssetCatalog,
        );
        this._componentTypesByKey = componentTypesByKey;
        this._onPendingChange = onPendingChange;
        this._pendingEdits = 0;
    }

    get IsBusy() {
        return this._history.IsBusy || this._pendingEdits > 0;
    }

    get AssetAccess() {
        return this._assetAccess;
    }

    ClearComponentTypes() {
        this._componentTypesByKey.clear();
    }

    RegisterComponentType(key, componentType) {
        this._componentTypesByKey.set(key, componentType);
    }

    GetComponentType(key) {
        return this._componentTypesByKey.get(key);
    }

    GetDefinition(componentType) {
        return this._componentRegistry.Get(componentType);
    }

    async ApplyInput(scene, entityId, input) {
        const fieldId = input.dataset.inspectorField;
        const definition = this._GetDefinitionForField(input, fieldId)?.definition;
        const isPending = definition?.asyncApply === true;
        if (isPending) {
            this._SetPendingEdit(1);
        }

        try {
            const previousState = this._CaptureState(
                scene,
                entityId,
                input,
                fieldId,
            );
            await this._ApplyField(scene, entityId, input, fieldId);
            this._RecordChange(
                scene,
                entityId,
                input,
                fieldId,
                previousState,
            );
            return {
                refresh: Boolean(definition?.refreshOnChange?.includes(fieldId)),
            };
        } finally {
            if (isPending) {
                this._SetPendingEdit(-1);
            }
        }
    }

    RestoreRejectedInput(scene, entityId, input, fieldId) {
        if (!input.isConnected) {
            return;
        }

        const entityManager = scene.EntityManager;
        if (fieldId === "entity.active") {
            input.checked = entityManager.IsEntityActive(entityId);
            return;
        }

        const enabledField = this._ResolveEnabledField(fieldId);
        if (enabledField !== null) {
            const { componentType } = enabledField;
            if (componentType) {
                input.checked = entityManager.IsComponentEnabled(
                    entityId,
                    componentType,
                );
            }
            return;
        }

        const context = this._CreateFieldContext(
            scene,
            entityId,
            input,
            fieldId,
        );
        try {
            context.definition?.restoreInput?.(context);
        } catch {
            // Keep the validation message visible if the component disappeared.
        }
    }

    _SetPendingEdit(delta) {
        this._pendingEdits += delta;
        this._onPendingChange();
    }

    async _ApplyField(scene, entityId, input, fieldId) {
        const entityManager = scene.EntityManager;
        if (fieldId === "entity.name") {
            input.value = entityManager.SetEntityName(entityId, input.value);
            return;
        }
        if (fieldId === "entity.active") {
            scene.SetEntityActive(entityId, input.checked);
            return;
        }

        const enabledField = this._ResolveEnabledField(fieldId);
        if (enabledField !== null) {
            const { componentType } = enabledField;
            if (!componentType) {
                throw new Error("Inspector component is no longer available.");
            }
            scene.SetComponentEnabled(entityId, componentType, input.checked);
            return;
        }

        const context = this._CreateFieldContext(
            scene,
            entityId,
            input,
            fieldId,
        );
        if (typeof context.definition?.apply !== "function") {
            throw new Error("This Inspector field cannot be edited.");
        }
        await context.definition.apply(context);
    }

    _CaptureState(scene, entityId, input, fieldId) {
        const entityManager = scene.EntityManager;
        const builtInHandler = BUILT_IN_EDIT_HANDLERS.get(fieldId);
        if (builtInHandler) {
            return {
                kind: fieldId,
                value: builtInHandler.capture({ entityManager, entityId }),
            };
        }

        const enabledField = this._ResolveEnabledField(fieldId);
        if (enabledField !== null) {
            const { componentType } = enabledField;
            if (!componentType) {
                throw new Error("Inspector component is no longer available.");
            }
            return {
                kind: "component-enabled",
                componentType,
                value: entityManager.IsComponentEnabled(entityId, componentType),
            };
        }

        const context = this._CreateFieldContext(
            scene,
            entityId,
            input,
            fieldId,
        );
        if (!context.definition?.capture || !context.definition.restore) {
            return null;
        }
        return {
            kind: "component",
            componentType: context.componentType,
            value: context.definition.capture(context),
        };
    }

    _RecordChange(scene, entityId, input, fieldId, previousState) {
        if (previousState === null) {
            return;
        }

        const nextState = this._CaptureState(scene, entityId, input, fieldId);
        if (this._EditStatesEqual(previousState, nextState)) {
            return;
        }

        this._history.RecordApplied({
            scene,
            label: this._GetEditLabel(input, fieldId, scene, entityId),
            undo: () =>
                this._ApplyState(scene, entityId, input, fieldId, previousState),
            redo: () =>
                this._ApplyState(scene, entityId, input, fieldId, nextState),
        });
    }

    async _ApplyState(scene, entityId, input, fieldId, state) {
        if (this._sceneManager.ActiveScene !== scene) {
            throw new Error("Cannot apply history to an inactive scene.");
        }

        const entityManager = scene.EntityManager;
        if (state.kind === "component-enabled") {
            scene.SetComponentEnabled(entityId, state.componentType, state.value);
            return;
        }

        const builtInHandler = BUILT_IN_EDIT_HANDLERS.get(state.kind);
        if (builtInHandler) {
            builtInHandler.apply({ scene, entityManager, entityId, value: state.value });
            return;
        }

        const context = this._CreateFieldContext(
            scene,
            entityId,
            input,
            fieldId,
            state.componentType,
        );
        if (!context.definition?.restore) {
            throw new Error("Inspector component cannot restore this history command.");
        }
        await context.definition.restore({ ...context, value: state.value });
    }

    _EditStatesEqual(left, right) {
        if (!left || !right || left.kind !== right.kind) {
            return false;
        }
        if (left.kind === "component") {
            if (left.componentType !== right.componentType) {
                return false;
            }
            const equals = this.GetDefinition(left.componentType)?.equals;
            return equals ? equals(left.value, right.value) : Object.is(left.value, right.value);
        }
        return AreDataValuesEqual(left.value, right.value);
    }

    _GetEditLabel(input, fieldId, scene, entityId) {
        if (fieldId === "entity.name") {
            return "Rename entity";
        }
        if (fieldId === "entity.active") {
            return "Change entity active state";
        }

        const enabledField = this._ResolveEnabledField(fieldId);
        if (enabledField !== null) {
            return `Toggle ${enabledField.componentType?.name ?? "component"}`;
        }

        const context = this._CreateFieldContext(
            scene,
            entityId,
            input,
            fieldId,
        );
        return context.definition?.getEditLabel?.(fieldId) ?? `Edit ${fieldId}`;
    }

    _ResolveEnabledField(fieldId) {
        const componentKey = GetComponentEnabledKey(fieldId);
        return componentKey === null
            ? null
            : {
                  componentType: this.GetComponentType(componentKey),
              };
    }

    _GetDefinitionForField(input, fieldId) {
        const section = input?.closest("[data-component-key]");
        const componentType = this.GetComponentType(
            section?.dataset.componentKey,
        );
        const definition = componentType
            ? this.GetDefinition(componentType)
            : null;
        if (
            !definition ||
            (definition.fieldPrefix && !fieldId.startsWith(definition.fieldPrefix))
        ) {
            return null;
        }
        return { componentType, definition };
    }

    _CreateFieldContext(scene, entityId, input, fieldId, componentType = null) {
        const entityManager = scene.EntityManager;
        const resolved = componentType
            ? { componentType, definition: this.GetDefinition(componentType) }
            : this._GetDefinitionForField(input, fieldId);
        return {
            scene,
            entityId,
            entityManager,
            componentType: resolved?.componentType,
            definition: resolved?.definition,
            component: resolved?.componentType
                ? entityManager.GetComponent(entityId, resolved.componentType)
                : null,
            input,
            fieldId,
            readNumber: (field) => this._ReadNumber(field),
            assetAccess: this._assetAccess,
        };
    }

    _ReadNumber(input) {
        if (!Number.isFinite(input.valueAsNumber)) {
            throw new TypeError("Enter a finite number.");
        }
        return input.valueAsNumber;
    }
}
