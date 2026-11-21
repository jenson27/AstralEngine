import { ComponentStorage } from "./component-storage.js";
import { CreateEntityId, IsEntityId } from "./entity-id.js";

export class EntityManager {
    constructor(beforeStructuralChange = () => {}) {
        if (typeof beforeStructuralChange !== "function") {
            throw new TypeError(
                "EntityManager change guard must be a function.",
            );
        }

        this._beforeStructuralChange = beforeStructuralChange;
        this._entities = new Set();
        this._entityNames = new Map();
        this._inactiveEntities = new Set();
        this._disabledComponents = new Map();
        this._componentStores = new Map();
        this._structuralRevision = 0;
        this._entityNameRevision = 0;
        this._entityStateRevision = 0;
        this._componentEnabledRevision = 0;
        this._activeQueryCount = 0;
        this._componentRemovalHandlers = new Map();
        this._pendingComponentRemovals = [];
    }

    get StructuralRevision() {
        return this._structuralRevision;
    }

    get EntityNameRevision() {
        return this._entityNameRevision;
    }

    get EntityStateRevision() {
        return this._entityStateRevision;
    }

    get ComponentEnabledRevision() {
        return this._componentEnabledRevision;
    }

    CreateEntity(entityId = CreateEntityId(), name = "Entity") {
        if (!IsEntityId(entityId)) {
            throw new TypeError("Entity ID must be a lowercase UUID.");
        }

        this._RequireEntityName(name);

        if (this._entities.has(entityId)) {
            throw new Error("Entity ID already exists: " + entityId);
        }

        this._beforeStructuralChange({ type: "create-entity", entityId });
        this._entities.add(entityId);
        this._entityNames.set(entityId, name.trim());
        this._structuralRevision += 1;
        return entityId;
    }

    DestroyEntity(entityId) {
        this._RequireEntity(entityId);
        this._RequireNoActiveQueries();
        this._beforeStructuralChange({ type: "destroy-entity", entityId });
        this._entities.delete(entityId);
        this._entityNames.delete(entityId);
        this._inactiveEntities.delete(entityId);
        this._disabledComponents.delete(entityId);
        this._RemoveEntityComponents(entityId);
        this._structuralRevision += 1;
    }

    _RemoveEntityComponents(entityId) {
        for (const [componentType, storage] of this._componentStores) {
            if (!storage.Has(entityId)) {
                continue;
            }

            const component = storage.Get(entityId);
            storage.Remove(entityId);
            this._QueueComponentRemoval(entityId, componentType, component);
        }
    }

    DestroyAllEntities() {
        this._RequireNoActiveQueries();
        this._beforeStructuralChange({ type: "destroy-all-entities" });

        for (const entityId of [...this._entities]) {
            this.DestroyEntity(entityId);
        }
    }

    GetEntityIds() {
        return [...this._entities];
    }

    GetEntityName(entityId) {
        this._RequireEntity(entityId);
        return this._entityNames.get(entityId);
    }

    SetEntityName(entityId, name) {
        this._RequireEntity(entityId);
        this._RequireEntityName(name);

        const normalizedName = name.trim();

        if (this._entityNames.get(entityId) !== normalizedName) {
            this._entityNames.set(entityId, normalizedName);
            this._entityNameRevision += 1;
        }

        return normalizedName;
    }

    IsEntityActive(entityId) {
        this._RequireEntity(entityId);
        return !this._inactiveEntities.has(entityId);
    }

    SetEntityActive(entityId, isActive) {
        this._RequireEntity(entityId);

        if (typeof isActive !== "boolean") {
            throw new TypeError("Entity active state must be a boolean.");
        }

        const isCurrentlyActive = !this._inactiveEntities.has(entityId);
        if (isCurrentlyActive === isActive) {
            return false;
        }

        this._RequireNoActiveQueries();
        this._beforeStructuralChange({
            type: "set-entity-active",
            entityId,
            isActive,
        });

        if (isActive) {
            this._inactiveEntities.delete(entityId);
        } else {
            this._inactiveEntities.add(entityId);
        }

        this._entityStateRevision += 1;
        return true;
    }

    IsComponentEnabled(entityId, componentType) {
        this._RequireEntity(entityId);
        this._RequireComponentType(componentType);

        if (!this._componentStores.get(componentType)?.Has(entityId)) {
            throw new Error("Entity does not have the requested component.");
        }

        return !this._disabledComponents
            .get(entityId)
            ?.has(componentType);
    }

    SetComponentEnabled(entityId, componentType, isEnabled) {
        this._RequireEntity(entityId);
        this._RequireComponentType(componentType);

        if (!this._componentStores.get(componentType)?.Has(entityId)) {
            throw new Error("Entity does not have the requested component.");
        }

        if (typeof isEnabled !== "boolean") {
            throw new TypeError("Component enabled state must be a boolean.");
        }

        if (componentType.CanBeDisabled === false && !isEnabled) {
            throw new Error("This component cannot be disabled.");
        }

        const isCurrentlyEnabled = !this._disabledComponents
            .get(entityId)
            ?.has(componentType);
        if (isCurrentlyEnabled === isEnabled) {
            return false;
        }

        this._RequireNoActiveQueries();
        this._beforeStructuralChange({
            type: "set-component-enabled",
            entityId,
            componentType,
            isEnabled,
        });

        let disabledComponents = this._disabledComponents.get(entityId);
        if (!disabledComponents) {
            disabledComponents = new Set();
            this._disabledComponents.set(entityId, disabledComponents);
        }

        if (isEnabled) {
            disabledComponents.delete(componentType);
            if (disabledComponents.size === 0) {
                this._disabledComponents.delete(entityId);
            }
        } else {
            disabledComponents.add(componentType);
        }

        this._componentEnabledRevision += 1;
        return true;
    }

    GetComponentEntries(entityId) {
        this._RequireEntity(entityId);

        const components = [];
        for (const [componentType, storage] of this._componentStores) {
            if (storage.Has(entityId)) {
                components.push({
                    componentType,
                    component: storage.Get(entityId),
                });
            }
        }

        return components;
    }

    AddComponent(entityId, componentType, component) {
        this._RequireEntity(entityId);
        this._RequireComponentType(componentType);

        if (
            component === null ||
            typeof component !== "object" ||
            !(component instanceof componentType)
        ) {
            throw new TypeError(
                "Component must be an instance of the specified component type.",
            );
        }

        this._RequireNoActiveQueries();
        this._beforeStructuralChange({
            type: "add-component",
            entityId,
            componentType,
        });

        const storage = this._GetOrCreateStorage(componentType);
        storage.Add(entityId, component);
        this._structuralRevision += 1;
        return component;
    }

    GetComponent(entityId, componentType) {
        this._RequireEntity(entityId);
        this._RequireComponentType(componentType);
        return this._componentStores.get(componentType)?.Get(entityId);
    }

    HasComponent(entityId, componentType) {
        this._RequireEntity(entityId);
        this._RequireComponentType(componentType);
        return this._componentStores.get(componentType)?.Has(entityId) ?? false;
    }

    RemoveComponent(entityId, componentType) {
        this._RequireEntity(entityId);
        this._RequireComponentType(componentType);
        this._RequireNoActiveQueries();

        const storage = this._componentStores.get(componentType);
        if (!storage) {
            return false;
        }

        const component = storage.Get(entityId);
        if (component === undefined) {
            return false;
        }

        this._beforeStructuralChange({
            type: "remove-component",
            entityId,
            componentType,
        });
        storage.Remove(entityId);
        const disabledComponents = this._disabledComponents.get(entityId);
        disabledComponents?.delete(componentType);
        if (disabledComponents?.size === 0) {
            this._disabledComponents.delete(entityId);
        }
        this._QueueComponentRemoval(entityId, componentType, component);
        this._structuralRevision += 1;
        return true;
    }

    RegisterComponentRemovalHandler(componentType, handler) {
        this._RequireComponentType(componentType);
        if (typeof handler !== "function") {
            throw new TypeError("Component removal handler must be a function.");
        }

        let handlers = this._componentRemovalHandlers.get(componentType);
        if (!handlers) {
            handlers = new Set();
            this._componentRemovalHandlers.set(componentType, handlers);
        }

        handlers.add(handler);
        return () => {
            const registeredHandlers =
                this._componentRemovalHandlers.get(componentType);
            if (!registeredHandlers) {
                return;
            }

            registeredHandlers.delete(handler);
            if (registeredHandlers.size === 0) {
                this._componentRemovalHandlers.delete(componentType);
            }
        };
    }

    DispatchComponentRemovals() {
        const removals = this._pendingComponentRemovals;
        this._pendingComponentRemovals = [];
        const errors = [];

        for (const removal of removals) {
            const handlers = this._componentRemovalHandlers.get(
                removal.componentType,
            );
            if (!handlers) {
                continue;
            }

            for (const handler of [...handlers]) {
                try {
                    handler(removal);
                } catch (error) {
                    errors.push(error);
                }
            }
        }

        if (errors.length > 0) {
            throw new AggregateError(
                errors,
                "One or more component removal handlers failed.",
            );
        }
    }

    *Query(...componentTypes) {
        if (componentTypes.length === 0) {
            throw new TypeError("Query requires at least one component class.");
        }

        componentTypes.forEach((componentType) =>
            this._RequireComponentType(componentType),
        );

        const stores = componentTypes.map((componentType) =>
            this._componentStores.get(componentType),
        );

        if (stores.some((storage) => !storage)) {
            return;
        }

        const baseStorage = stores.reduce((smallest, storage) =>
            storage.Size < smallest.Size ? storage : smallest,
        );

        this._activeQueryCount++;

        try {
            for (const entityId of baseStorage.EntityIds()) {
                if (stores.every((storage) => storage.Has(entityId))) {
                    yield entityId;
                }
            }
        } finally {
            this._activeQueryCount--;
        }
    }

    _GetOrCreateStorage(componentType) {
        let storage = this._componentStores.get(componentType);

        if (!storage) {
            storage = new ComponentStorage();
            this._componentStores.set(componentType, storage);
        }

        return storage;
    }

    _RequireEntity(entityId) {
        if (!this._entities.has(entityId)) {
            throw new RangeError(`Entity ${entityId} does not exist.`);
        }
    }

    _RequireEntityName(name) {
        if (typeof name !== "string" || name.trim() === "") {
            throw new TypeError("Entity name must be a non-empty string.");
        }
    }

    _RequireNoActiveQueries() {
        if (this._activeQueryCount > 0) {
            throw new Error(
                "Cannot change entity or component state during an active query. " +
                    "Queue structural changes through the system command buffer.",
            );
        }
    }

    _QueueComponentRemoval(entityId, componentType, component) {
        if (!this._componentRemovalHandlers.has(componentType)) {
            return;
        }

        this._pendingComponentRemovals.push({
            entityId,
            componentType,
            component,
        });
    }

    _RequireComponentType(componentType) {
        if (
            typeof componentType !== "function" ||
            componentType.prototype === undefined ||
            componentType.prototype === null
        ) {
            throw new TypeError("Component type must be a class.");
        }
    }
}
