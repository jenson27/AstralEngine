import { IsEntityId } from "../core/ecs/entity-id.js";

export class Parent {
    static CanBeDisabled = false;

    constructor(parentEntityId) {
        if (!IsEntityId(parentEntityId)) {
            throw new TypeError(
                "Parent requires a valid parent entity ID.",
            );
        }

        this._parentEntityId = parentEntityId;
    }

    get ParentEntityId() {
        return this._parentEntityId;
    }
}
