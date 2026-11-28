import { Camera } from "../../components/graphics/camera.js";
import { Transform } from "../../components/transform.js";
import { Scene } from "./scene.js";

export class SceneBuilder {
    constructor(componentRegistry) {
        this._componentRegistry = componentRegistry;
    }

    Build(data, { systems = [], componentServices = {} } = {}, entityIds) {
        const scene = new Scene(data.name);

        try {
            this._RegisterSystems(scene, systems);
            this._LoadEntities(scene, data, componentServices);
            this._SetActiveCamera(
                scene,
                data.activeCameraEntityId,
                entityIds,
            );

            scene.Initialize();
            return scene;
        } catch (error) {
            try {
                scene.Dispose();
            } catch (cleanupError) {
                throw new AggregateError(
                    [error, cleanupError],
                    "Scene loading and cleanup failed.",
                );
            }

            throw error;
        }
    }

    _RegisterSystems(scene, systems) {
        for (const registration of systems) {
            if (!registration || typeof registration !== "object") {
                throw new TypeError("System registration must be an object.");
            }

            scene.AddSystem(registration.phase, registration.system);
        }
    }

    _LoadEntities(scene, data, services) {
        for (const entityData of data.entities) {
            const entityId = scene.EntityManager.CreateEntity(
                entityData.id,
                entityData.name ?? "Entity",
            );

            if (entityData.active === false) {
                scene.EntityManager.SetEntityActive(entityId, false);
            }

            for (const componentRecord of entityData.components) {
                const { typeId } = componentRecord;

                try {
                    const { componentType, component } =
                        this._componentRegistry.DeserializeComponent(
                            componentRecord,
                            services,
                        );

                    scene.EntityManager.AddComponent(
                        entityId,
                        componentType,
                        component,
                    );
                    if (componentRecord.enabled === false) {
                        scene.EntityManager.SetComponentEnabled(
                            entityId,
                            componentType,
                            false,
                        );
                    }
                } catch (error) {
                    throw new Error(
                        `Failed to load component "${typeId}" for entity ${entityId}.`,
                        { cause: error },
                    );
                }
            }
        }
    }

    _SetActiveCamera(scene, cameraEntityId, entityIds) {
        if (!entityIds.has(cameraEntityId)) {
            throw new Error(
                "Active camera entity does not exist in the scene.",
            );
        }

        if (
            !scene.EntityManager.HasComponent(cameraEntityId, Camera) ||
            !scene.EntityManager.HasComponent(cameraEntityId, Transform)
        ) {
            throw new Error(
                "Active camera entity must have Camera and Transform components.",
            );
        }

        scene.SetActiveCameraEntity(cameraEntityId);
    }
}
