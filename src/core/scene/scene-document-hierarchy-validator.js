import { IsEntityId } from "../ecs/entity-id.js";

export function ValidateActiveCameraTransform(data) {
    const { scalesByEntityId, parentByChildId } =
        BuildTransformHierarchyLookups(data.entities);

    ValidateActiveCameraHierarchyScale(
        data.activeCameraEntityId,
        scalesByEntityId,
        parentByChildId,
    );
}

export function ValidateSceneParentRelationships(entities, entityIds) {
    const transformEntityIds = new Set();
    const parentByChildId = new Map();

    CollectParentRelationships(
        entities,
        entityIds,
        transformEntityIds,
        parentByChildId,
    );
    ValidateParentTransformTargets(parentByChildId, transformEntityIds);
    ValidateParentHierarchyCycles(parentByChildId);
}

function BuildTransformHierarchyLookups(entities) {
    const scalesByEntityId = new Map();
    const parentByChildId = new Map();

    for (const entityData of entities) {
        for (const componentRecord of entityData.components) {
            if (componentRecord.typeId === "transform") {
                scalesByEntityId.set(
                    entityData.id,
                    componentRecord.data?.scale,
                );
            }

            if (componentRecord.typeId === "parent") {
                parentByChildId.set(
                    entityData.id,
                    componentRecord.data?.parentEntityId,
                );
            }
        }
    }

    return { scalesByEntityId, parentByChildId };
}

function ValidateActiveCameraHierarchyScale(
    cameraEntityId,
    scalesByEntityId,
    parentByChildId,
) {
    let entityId = cameraEntityId;
    const visitedEntityIds = new Set();

    while (entityId !== undefined) {
        if (visitedEntityIds.has(entityId)) {
            throw new Error("Parent hierarchy contains a cycle.");
        }

        visitedEntityIds.add(entityId);

        const scale = scalesByEntityId.get(entityId);

        // The component loader reports malformed Transform data.
        if (
            !Array.isArray(scale) ||
            scale.length !== 3 ||
            !scale.every(Number.isFinite)
        ) {
            return;
        }

        if (scale.some((value) => Math.abs(value - 1) > 1e-6)) {
            throw new RangeError(
                "The active camera and its parents must have unit scale.",
            );
        }

        entityId = parentByChildId.get(entityId);
    }
}

function CollectParentRelationships(
    entities,
    entityIds,
    transformEntityIds,
    parentByChildId,
) {
    for (const entityData of entities) {
        const componentTypeIds = new Set(
            entityData.components.map(({ typeId }) => typeId),
        );

        if (componentTypeIds.has("transform")) {
            transformEntityIds.add(entityData.id);
        }

        const parentRecord = entityData.components.find(
            ({ typeId }) => typeId === "parent",
        );

        if (!parentRecord) {
            continue;
        }

        if (!componentTypeIds.has("transform")) {
            throw new Error(
                `Entity "${entityData.id}" with a Parent component must have a Transform component.`,
            );
        }

        const parentEntityId = parentRecord.data?.parentEntityId;

        if (
            !IsEntityId(parentEntityId) ||
            !entityIds.has(parentEntityId)
        ) {
            throw new Error(
                `Parent component on entity "${entityData.id}" must reference an existing entity ID.`,
            );
        }

        parentByChildId.set(entityData.id, parentEntityId);
    }
}

function ValidateParentTransformTargets(
    parentByChildId,
    transformEntityIds,
) {
    for (const parentEntityId of parentByChildId.values()) {
        if (!transformEntityIds.has(parentEntityId)) {
            throw new Error(
                `Parent entity "${parentEntityId}" must have a Transform component.`,
            );
        }
    }
}

function ValidateParentHierarchyCycles(parentByChildId) {
    const visitStateByEntityId = new Map();

    for (const entityId of parentByChildId.keys()) {
        let currentEntityId = entityId;
        const path = [];

        while (
            currentEntityId !== undefined &&
            visitStateByEntityId.get(currentEntityId) !== "visited"
        ) {
            if (visitStateByEntityId.get(currentEntityId) === "visiting") {
                throw new Error("Parent hierarchy contains a cycle.");
            }

            visitStateByEntityId.set(currentEntityId, "visiting");
            path.push(currentEntityId);
            currentEntityId = parentByChildId.get(currentEntityId);
        }

        for (const pathEntityId of path) {
            visitStateByEntityId.set(pathEntityId, "visited");
        }
    }
}
