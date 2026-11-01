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
        this._componentStores = new Map();
        this._activeQueryCount = 0;
        this._componentRemovalHandlers = new Map();
        this._pendingComponentRemovals = [];
    }

    CreateEntity(entityId = CreateEntityId()) {
        if (!IsEntityId(entityId)) {
            throw new TypeError("Entity ID must be a lowercase UUID.");
        }

        if (this._entities.has(entityId)) {
            throw new Error("Entity ID already exists: " + entityId);
        }

        this._beforeStructuralChange({ type: "create-entity", entityId });
        this._entities.add(entityId);
        return entityId;
    }

    DestroyEntity(entityId) {
        this._RequireEntity(entityId);
        this._RequireNoActiveQueries();
        this._beforeStructuralChange({ type: "destroy-entity", entityId });
        this._entities.delete(entityId);

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
        this._QueueComponentRemoval(entityId, componentType, component);
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

    _RequireNoActiveQueries() {
        if (this._activeQueryCount > 0) {
            throw new Error(
                "Cannot change component membership during an active query. " +
                    "Queue the change through the system command buffer.",
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
