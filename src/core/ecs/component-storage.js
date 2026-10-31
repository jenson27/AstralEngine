export class ComponentStorage {
    constructor() {
        this._entities = [];
        this._components = [];
        this._indices = new Map();
    }

    get Size() {
        return this._entities.length;
    }

    Add(entityId, component) {
        if (this._indices.has(entityId)) {
            throw new Error(`Entity ${entityId} already has this component.`);
        }

        const componentIndex = this._entities.length;
        this._entities.push(entityId);
        this._components.push(component);
        this._indices.set(entityId, componentIndex);
    }

    Get(entityId) {
        const componentIndex = this._indices.get(entityId);

        return componentIndex === undefined
            ? undefined
            : this._components[componentIndex];
    }

    Has(entityId) {
        return this._indices.has(entityId);
    }

    Remove(entityId) {
        const componentIndex = this._indices.get(entityId);

        if (componentIndex === undefined) {
            return false;
        }

        const lastIndex = this._entities.length - 1;
        const lastEntityId = this._entities[lastIndex];

        if (componentIndex !== lastIndex) {
            this._entities[componentIndex] = lastEntityId;
            this._components[componentIndex] = this._components[lastIndex];
            this._indices.set(lastEntityId, componentIndex);
        }

        this._entities.pop();
        this._components.pop();
        this._indices.delete(entityId);
        return true;
    }

    *EntityIds() {
        yield* this._entities;
    }
}
