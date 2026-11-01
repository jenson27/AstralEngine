import { Scene } from "./scene.js";
import { AstralLogger } from "../diagnostics/logger.js";
import { JsonFormat } from "../serialization/json-format.js";
import { Camera } from "../components/graphics/camera.js";
import { Transform } from "../components/transform.js";
import { IsEntityId } from "./ecs/entity-id.js";

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
            const scene = await this.LoadDataAsync(data, options);

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

    LoadData(data, options = {}) {
        const entityIds = this._ValidateSceneData(data);

        if ((data.assets?.length ?? 0) > 0 && !options.assetScope) {
            throw new Error(
                "Scene data with assets requires an asset scope or LoadDataAsync().",
            );
        }

        return this._BuildScene(data, options, entityIds);
    }

    async LoadDataAsync(data, options = {}) {
        const entityIds = this._ValidateSceneData(data);
        await this._LoadSceneAssets(
            data.assets ?? [],
            options.assetScope,
        );

        return this._BuildScene(data, options, entityIds);
    }

    async _LoadSceneAssets(assetIds, assetScope) {
        if (assetIds.length === 0) {
            return;
        }

        if (!assetScope || typeof assetScope.Acquire !== "function") {
            throw new TypeError(
                "Loading scene assets requires an asset scope.",
            );
        }

        await Promise.all(
            assetIds.map((assetId) => assetScope.Acquire(assetId)),
        );
    }

    _BuildScene(data, { systems = [], services = {} } = {}, entityIds) {
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
            const entityId = scene.EntityManager.CreateEntity(
                entityData.id,
                entityData.name ?? "Entity",
            );

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
            data.version !== 1
        ) {
            throw new Error("Unsupported scene format or version.");
        }

        if (typeof data.name !== "string" || data.name.trim() === "") {
            throw new TypeError("Scene name must be a non-empty string.");
        }

        if (!Array.isArray(data.entities)) {
            throw new TypeError("Scene entities must be an array.");
        }

        this._ValidateSceneAssetIds(data.assets);

        if (!IsEntityId(data.activeCameraEntityId)) {
            throw new TypeError(
                "Scene must define a valid active camera UUID.",
            );
        }

        const entityIds = new Set();
        for (const entityData of data.entities) {
            this._ValidateEntityData(entityData, entityIds);
        }

        this._ValidateSceneAssetReferences(data);

        return entityIds;
    }

    _ValidateSceneAssetIds(assetIds) {
        if (assetIds === undefined) {
            return;
        }

        if (!Array.isArray(assetIds)) {
            throw new TypeError("Scene assets must be an array.");
        }

        const seenAssetIds = new Set();

        for (const assetId of assetIds) {
            if (typeof assetId !== "string" || assetId.trim() === "") {
                throw new TypeError(
                    "Scene asset IDs must be non-empty strings.",
                );
            }

            if (seenAssetIds.has(assetId)) {
                throw new Error(
                    "Duplicate scene asset ID: " + assetId,
                );
            }

            seenAssetIds.add(assetId);
        }
    }

    _ValidateSceneAssetReferences(data) {
        if (data.assets === undefined) {
            return;
        }

        const declaredAssetIds = new Set(data.assets);

        for (const entityData of data.entities) {
            for (const componentRecord of entityData.components) {
                if (componentRecord.typeId !== "meshRenderer") {
                    continue;
                }

                const componentData = componentRecord.data;
                const assetReferences = [
                    ["meshAssetId", componentData?.meshAssetId],
                ];

                if (componentData?.defaultMaterialAssetId !== undefined) {
                    assetReferences.push([
                        "defaultMaterialAssetId",
                        componentData.defaultMaterialAssetId,
                    ]);
                } else {
                    const materialsBySlot = componentData?.materialsBySlot;

                    if (
                        !materialsBySlot ||
                        typeof materialsBySlot !== "object" ||
                        Array.isArray(materialsBySlot)
                    ) {
                        throw new TypeError(
                            "MeshRenderer materialsBySlot must be an object.",
                        );
                    }

                    const materialEntries = Object.entries(materialsBySlot);

                    if (materialEntries.length === 0) {
                        throw new TypeError(
                            "MeshRenderer must define at least one material slot.",
                        );
                    }

                    for (const [materialSlot, assetId] of materialEntries) {
                        if (materialSlot.trim() === "") {
                            throw new TypeError(
                                "MeshRenderer material slot names must not be empty.",
                            );
                        }

                        assetReferences.push([
                            `materialsBySlot.${materialSlot}`,
                            assetId,
                        ]);
                    }
                }

                for (const [field, assetId] of assetReferences) {
                    if (
                        typeof assetId !== "string" ||
                        assetId.trim() === ""
                    ) {
                        throw new TypeError(
                            `MeshRenderer ${field} must be a non-empty asset ID.`,
                        );
                    }

                    if (!declaredAssetIds.has(assetId)) {
                        throw new Error(
                            `MeshRenderer asset "${assetId}" is not listed in scene assets.`,
                        );
                    }
                }
            }
        }
    }

    _ValidateEntityData(entityData, entityIds) {
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

        this._ValidateComponentRecords(entityData.components);
    }

    _ValidateComponentRecords(components) {
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
