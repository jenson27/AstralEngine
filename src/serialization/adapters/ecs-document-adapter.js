import { Camera } from "../../components/graphics/camera.js";
import { Transform } from "../../components/transform.js";

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
        if (
            !Number.isSafeInteger(activeCameraEntityId) ||
            activeCameraEntityId <= 0
        ) {
            throw new TypeError("Scene must have a valid active camera ID.");
        }

        const entityManager = scene.EntityManager;
        const entityIds = entityManager.GetEntityIds();

        if (!entityIds.includes(activeCameraEntityId)) {
            throw new Error("Active camera entity does not exist in the scene.");
        }

        if (
            !entityManager.HasComponent(activeCameraEntityId, Camera) ||
            !entityManager.HasComponent(activeCameraEntityId, Transform)
        ) {
            throw new Error(
                "Active camera entity must have Camera and Transform components.",
            );
        }

        return {
            format: "astral-scene",
            version: 2,
            name: scene.Name,
            activeCameraEntityId,
            entities: entityIds.map((entityId) => ({
                id: entityId,
                components: entityManager
                    .GetComponentEntries(entityId)
                    .map(({ component }) =>
                        this._componentRegistry.SerializeComponent(
                            component,
                            context,
                        ),
                    ),
            })),
        };
    }
}
