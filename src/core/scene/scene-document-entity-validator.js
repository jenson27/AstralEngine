import { IsEntityId } from "../ecs/entity-id.js";

export function ValidateSceneEntities(entities) {
    const entityIds = new Set();

    for (const entityData of entities) {
        ValidateEntityData(entityData, entityIds);
    }

    return entityIds;
}

export function ValidateActiveCameraEntity(cameraEntityId, entities) {
    const cameraEntity = entities.find(
        (entity) => entity.id === cameraEntityId,
    );

    if (!cameraEntity) {
        throw new Error(
            "Active camera entity does not exist in the scene.",
        );
    }

    const componentTypeIds = new Set(
        cameraEntity.components.map(({ typeId }) => typeId),
    );

    if (
        !componentTypeIds.has("camera") ||
        !componentTypeIds.has("transform")
    ) {
        throw new Error(
            "Active camera entity must have Camera and Transform components.",
        );
    }
}

function ValidateEntityData(entityData, entityIds) {
    if (!entityData || typeof entityData !== "object") {
        throw new TypeError("Each scene entity must be an object.");
    }

    if (
        entityData.name !== undefined &&
        (typeof entityData.name !== "string" ||
            entityData.name.trim() === "")
    ) {
        throw new TypeError(
            "Entity name must be a non-empty string when provided.",
        );
    }

    if (
        entityData.active !== undefined &&
        typeof entityData.active !== "boolean"
    ) {
        throw new TypeError("Entity active state must be a boolean.");
    }

    if (!IsEntityId(entityData.id)) {
        throw new TypeError("Entity IDs must be lowercase UUID strings.");
    }

    if (entityIds.has(entityData.id)) {
        throw new Error("Duplicate scene entity ID: " + entityData.id);
    }

    entityIds.add(entityData.id);

    if (!Array.isArray(entityData.components)) {
        throw new TypeError(
            "Scene entity components must be an array of typed records.",
        );
    }

    ValidateComponentRecords(entityData.components);
}

function ValidateComponentRecords(components) {
    const componentTypeIds = new Set();

    for (const componentRecord of components) {
        if (
            !componentRecord ||
            typeof componentRecord !== "object" ||
            Array.isArray(componentRecord)
        ) {
            throw new TypeError("Each component record must be an object.");
        }

        if (
            typeof componentRecord.typeId !== "string" ||
            componentRecord.typeId.trim() === ""
        ) {
            throw new TypeError("Component records must have a type ID.");
        }

        if (componentTypeIds.has(componentRecord.typeId)) {
            throw new Error(
                "Duplicate component type ID: " + componentRecord.typeId,
            );
        }

        componentTypeIds.add(componentRecord.typeId);

        if (
            !Number.isSafeInteger(componentRecord.version) ||
            componentRecord.version <= 0 ||
            !Object.hasOwn(componentRecord, "data")
        ) {
            throw new TypeError(
                "Component record must define a positive version and data.",
            );
        }

        if (
            componentRecord.enabled !== undefined &&
            typeof componentRecord.enabled !== "boolean"
        ) {
            throw new TypeError(
                "Component enabled state must be a boolean.",
            );
        }
    }
}
