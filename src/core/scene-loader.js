import { Scene } from "./scene.js";
import { AstralLogger } from "../diagnostics/logger.js";
import { JsonFormat } from "../serialization/json-format.js";
import { Camera } from "../components/graphics/camera.js";
import { Transform } from "../components/transform.js";

export class SceneLoader {
    constructor(
        componentRegistry,
        fetcher = globalThis.fetch?.bind(globalThis),
    ) {
        // Validate that the component registry has a DeserializeComponent method, otherwise throw an error.
        if (
            !componentRegistry ||
            typeof componentRegistry.DeserializeComponent !== "function"
        ) {
            throw new TypeError(
                "SceneLoader requires a component deserializer.",
            );
        }

        // Validate that the fetcher is a function if provided, otherwise throw an error.
        if (typeof fetcher !== "function") {
            throw new TypeError("SceneLoader requires a fetch function.");
        }

        // Store the component registry and fetcher for later use.
        this._componentRegistry = componentRegistry;
        this._fetcher = fetcher;
    }

    // Load a scene from a URL, returning a Promise that resolves to the loaded Scene object.
    async Load(url, options = {}) {
        let stage = "fetch scene";
        AstralLogger.Info("Loading scene.", { url });

        try {
            const response = await this._fetcher(url);
            AstralLogger.Debug("Scene response received.", {
                url,
                status: response.status,
                ok: response.ok,
            });

            if (!response.ok) {
                throw new Error(
                    "Could not load scene. HTTP " + response.status + ".",
                );
            }

            stage = "read scene response body";
            const text = await response.text();

            stage = "parse scene JSON";
            let data;
            try {
                data = JsonFormat.Parse(text);
            } catch (error) {
                const parseError = new Error(
                    "Scene response is not valid JSON.",
                );
                parseError.cause = error;
                throw parseError;
            }

            stage = "build scene";
            const scene = this.LoadData(data, options);

            AstralLogger.Info("Scene loaded.", {
                url,
                sceneName: scene.Name,
                entityCount: data.entities.length,
            });

            return scene;
        } catch (error) {
            throw new Error(
                `Scene load failed during "${stage}" for "${url}".`,
                { cause: error },
            );
        }
    }

    LoadData(data, { systems = [], services = {} } = {}) {
        const entityIds = this._ValidateSceneData(data);
        const scene = new Scene(data.name);

        try {
            this._RegisterSystems(scene, systems);
            this._LoadEntities(scene, data, services);
            this._SetActiveCamera(
                scene,
                data.activeCameraEntityId,
                entityIds,
            );

            scene.Initialize(services);
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
            const entityId = scene.EntityManager.CreateEntity(entityData.id);

            const componentRecords =
                data.version === 1
                    ? Object.entries(entityData.components).map(
                          ([typeId, componentData]) => ({
                              typeId,
                              version: 1,
                              data: componentData,
                          }),
                      )
                    : entityData.components;

            for (const componentRecord of componentRecords) {
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

    _ValidateSceneData(data) {
        if (!data || typeof data !== "object" || Array.isArray(data)) {
            throw new TypeError("Scene data must be an object.");
        }

        if (
            data.format !== "astral-scene" ||
            (data.version !== 1 && data.version !== 2)
        ) {
            throw new Error("Unsupported scene format or version.");
        }

        if (typeof data.name !== "string" || data.name.trim() === "") {
            throw new TypeError("Scene name must be a non-empty string.");
        }

        if (!Array.isArray(data.entities)) {
            throw new TypeError("Scene entities must be an array.");
        }

        if (
            !Number.isSafeInteger(data.activeCameraEntityId) ||
            data.activeCameraEntityId <= 0
        ) {
            throw new TypeError("Scene must define a valid active camera ID.");
        }

        const entityIds = new Set();
        for (const entityData of data.entities) {
            this._ValidateEntityData(entityData, data.version, entityIds);
        }

        return entityIds;
    }

    _ValidateEntityData(entityData, version, entityIds) {
        if (!entityData || typeof entityData !== "object") {
            throw new TypeError("Each scene entity must be an object.");
        }

        if (!Number.isSafeInteger(entityData.id) || entityData.id <= 0) {
            throw new TypeError("Entity IDs must be positive integers.");
        }

        if (entityIds.has(entityData.id)) {
            throw new Error("Duplicate scene entity ID: " + entityData.id);
        }

        entityIds.add(entityData.id);

        if (version === 1) {
            if (
                !entityData.components ||
                typeof entityData.components !== "object" ||
                Array.isArray(entityData.components)
            ) {
                throw new TypeError(
                    "Version 1 entity components must be an object keyed by type ID.",
                );
            }

            const componentTypeIds = Object.keys(entityData.components);
            if (componentTypeIds.some((typeId) => typeId.trim() === "")) {
                throw new TypeError(
                    "Version 1 component type IDs must be non-empty strings.",
                );
            }

            return;
        }

        if (!Array.isArray(entityData.components)) {
            throw new TypeError(
                "Version 2 entity components must be an array of typed records.",
            );
        }

        this._ValidateVersion2ComponentRecords(entityData.components);
    }

    _ValidateVersion2ComponentRecords(components) {
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
        }
    }
}
