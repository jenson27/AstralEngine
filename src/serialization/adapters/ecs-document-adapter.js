// EcsDocumentAdapter converts a live ECS scene into a plain JSON-ready scene document.

import { Camera } from "../../components/graphics/camera.js";
import { Transform } from "../../components/transform.js";
import { IsEntityId } from "../../core/ecs/entity-id.js";

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
            typeof scene.EntityManager.GetComponentEntries !== "function"
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

        const assetIds = new Set();
        const entities = entityIds.map((entityId) => ({
            id: entityId,
            components: entityManager
                .GetComponentEntries(entityId)
                .map(({ component }) =>
                    this._componentRegistry.SerializeComponent(
                        component,
                        context,
                    ),
                ),
        }));

        for (const entity of entities) {
            for (const component of entity.components) {
                if (component.typeId !== "meshRenderer") {
                    continue;
                }

                assetIds.add(component.data.meshAssetId);

                for (const materialAssetId of Object.values(
                    component.data.materialsBySlot,
                )) {
                    assetIds.add(materialAssetId);
                }
            }
        }

        return {
            format: "astral-scene",
            version: 1,
            name: scene.Name,
            activeCameraEntityId,
            assets: [...assetIds].sort(),
            entities,
        };
    }
}
