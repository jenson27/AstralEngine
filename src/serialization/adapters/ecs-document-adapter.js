// EcsDocumentAdapter converts a live ECS scene into a plain JSON-ready scene document.

import { Camera } from "../../components/graphics/camera.js";
import { Transform } from "../../components/transform.js";
import { IsEntityId } from "../../core/ecs/entity-id.js";
import { GetSceneAssetReferences } from "../../core/scene/scene-asset-references.js";

export class EcsDocumentAdapter {
    constructor(componentRegistry) {
        if (
            !componentRegistry ||
            typeof componentRegistry.SerializeComponent !== "function"
        ) {
            throw new TypeError(
                "EcsDocumentAdapter requires a component serializer.",
            );
        }

        this._componentRegistry = componentRegistry;
    }

    Serialize(scene, context = {}) {
        if (
            !scene ||
            typeof scene.Name !== "string" ||
            !scene.EntityManager ||
            typeof scene.EntityManager.GetEntityIds !== "function" ||
            typeof scene.EntityManager.GetComponentEntries !== "function" ||
            typeof scene.EntityManager.GetEntityName !== "function"
        ) {
            throw new TypeError("ECS document requires a valid scene.");
        }

        const activeCameraEntityId = scene.ActiveCameraEntityId;
        if (!IsEntityId(activeCameraEntityId)) {
            throw new TypeError("Scene must have a valid active camera UUID.");
        }

        const entityManager = scene.EntityManager;
        const entityIds = entityManager.GetEntityIds();

        if (!entityIds.includes(activeCameraEntityId)) {
            throw new Error(
                "Active camera entity does not exist in the scene.",
            );
        }

        if (
            !entityManager.HasComponent(activeCameraEntityId, Camera) ||
            !entityManager.HasComponent(activeCameraEntityId, Transform)
        ) {
            throw new Error(
                "Active camera entity must have Camera and Transform components.",
            );
        }

        const entities = entityIds.map((entityId) =>
            this._SerializeEntity(entityManager, entityId, context),
        );

        return {
            format: "astral-scene",
            version: 1,
            name: scene.Name,
            activeCameraEntityId,
            assets: this._CollectAssetIds(entities),
            entities,
        };
    }

    _SerializeEntity(entityManager, entityId, context) {
        const entity = {
            name: entityManager.GetEntityName(entityId),
            id: entityId,
            components: entityManager
                .GetComponentEntries(entityId)
                .map(({ componentType, component }) =>
                    this._SerializeComponent(
                        entityManager,
                        entityId,
                        componentType,
                        component,
                        context,
                    ),
                ),
        };

        if (!entityManager.IsEntityActive(entityId)) {
            entity.active = false;
        }

        return entity;
    }

    _SerializeComponent(
        entityManager,
        entityId,
        componentType,
        component,
        context,
    ) {
        const componentRecord = this._componentRegistry.SerializeComponent(
            component,
            context,
        );

        if (!entityManager.IsComponentEnabled(entityId, componentType)) {
            componentRecord.enabled = false;
        }

        return componentRecord;
    }

    _CollectAssetIds(entities) {
        const assetIds = new Set();

        for (const entity of entities) {
            for (const component of entity.components) {
                for (const [, assetId] of GetSceneAssetReferences(
                    component.typeId,
                    { data: component.data },
                )) {
                    assetIds.add(assetId);
                }
            }
        }

        return [...assetIds].sort();
    }
}
