import { AngularVelocity } from "../components/angular-velocity.js";
import { CameraController } from "../components/graphics/camera-controller.js";
import { Camera } from "../components/graphics/camera.js";
import { MeshRenderer } from "../components/graphics/mesh-renderer.js";
import { ModelRenderer } from "../components/graphics/model-renderer.js";
import { Parent } from "../components/parent.js";
import { Transform } from "../components/transform.js";
import { GetSceneAssetReferences } from "../core/scene/scene-asset-references.js";
import { InspectorComponentRegistry } from "./panels/inspector/component-registry.js";
import { AngularVelocityInspector } from "./panels/inspector/components/angular-velocity-inspector.js";
import { CameraControllerInspector } from "./panels/inspector/components/camera-controller-inspector.js";
import { CameraInspector } from "./panels/inspector/components/camera-inspector.js";
import { MeshRendererInspector } from "./panels/inspector/components/mesh-renderer-inspector.js";
import { ModelRendererInspector } from "./panels/inspector/components/model-renderer-inspector.js";
import { ParentInspector } from "./panels/inspector/components/parent-inspector.js";
import { TransformInspector } from "./panels/inspector/components/transform-inspector.js";
import {
    CreateMeshRenderer,
    RenderMeshRendererAddFields,
} from "./component-authoring/mesh-renderer-authoring.js";
import {
    CreateModelRenderer,
    RenderModelRendererAddFields,
} from "./component-authoring/model-renderer-authoring.js";

function ValidateAssetIds(assetIds) {
    if (
        !Array.isArray(assetIds) ||
        !assetIds.every(
            (assetId) =>
                typeof assetId === "string" && assetId.trim() !== "",
        )
    ) {
        throw new TypeError("Component asset references must be asset ID strings.");
    }
    return [...new Set(assetIds)];
}

export class EditorComponentAuthoringCatalog {
    constructor() {
        this._definitionsById = new Map();
        this._definitionsByType = new Map();
        this._inspectorRegistry = new InspectorComponentRegistry();
    }

    Register(typeId, componentType, options = {}) {
        if (typeof typeId !== "string" || typeId.trim() === "") {
            throw new TypeError("Component authoring ID is required.");
        }
        const normalizedTypeId = typeId.trim();
        if (
            typeof componentType !== "function" ||
            !componentType.prototype
        ) {
            throw new TypeError("Component authoring type must be a class.");
        }

        const title = options.title;
        const create = options.create ?? null;
        const renderAddFields = options.renderAddFields ?? null;
        const canRemove = options.canRemove ?? true;
        const requiredComponentTypes = options.requiredComponentTypes ?? [];
        const inspector = options.inspector ?? null;
        const getAssetIds = options.getAssetIds ?? null;
        if (typeof title !== "string" || title.trim() === "") {
            throw new TypeError("Component authoring title is required.");
        }
        if (create !== null && typeof create !== "function") {
            throw new TypeError("Component factory must be a function.");
        }
        if (
            renderAddFields !== null &&
            typeof renderAddFields !== "function"
        ) {
            throw new TypeError("Component authoring fields must be a function.");
        }
        if (
            typeof canRemove !== "boolean" &&
            typeof canRemove !== "function"
        ) {
            throw new TypeError("Component removal policy is invalid.");
        }
        if (
            !Array.isArray(requiredComponentTypes) ||
            !requiredComponentTypes.every(
                (requiredType) =>
                    typeof requiredType === "function" &&
                    requiredType.prototype,
            )
        ) {
            throw new TypeError("Required component types must be classes.");
        }
        if (getAssetIds !== null && typeof getAssetIds !== "function") {
            throw new TypeError("Component asset reference provider must be a function.");
        }
        if (
            this._definitionsById.has(normalizedTypeId) ||
            this._definitionsByType.has(componentType)
        ) {
            throw new Error("Component authoring definition is already registered.");
        }

        if (inspector !== null) {
            this._inspectorRegistry.Register(componentType, inspector);
        }

        const definition = {
            typeId: normalizedTypeId,
            componentType,
            title: title.trim(),
            create,
            renderAddFields,
            canRemove,
            requiredComponentTypes: [...requiredComponentTypes],
            getAssetIds,
        };
        this._definitionsById.set(definition.typeId, definition);
        this._definitionsByType.set(componentType, definition);
    }

    GetById(typeId) {
        return this._definitionsById.get(typeId);
    }

    GetByType(componentType) {
        return this._definitionsByType.get(componentType);
    }

    GetInspectorByType(componentType) {
        return this._inspectorRegistry.Get(componentType);
    }

    GetAssetIdsForComponent(componentType, component, context = {}) {
        const definition = this.GetByType(componentType);
        const source = { ...context, component, state: null };
        const references = GetSceneAssetReferences(
            definition?.typeId,
            source,
        );
        const assetIds =
            references.length > 0
                ? references.map(([, assetId]) => assetId)
                : definition?.getAssetIds?.(source) ?? [];
        return ValidateAssetIds(assetIds);
    }

    GetAssetIdsForState(componentType, state, context = {}) {
        const definition = this.GetByType(componentType);
        const source = { ...context, component: null, state };
        const references = GetSceneAssetReferences(
            definition?.typeId,
            source,
        );
        const assetIds =
            references.length > 0
                ? references.map(([, assetId]) => assetId)
                : definition?.getAssetIds?.(source) ?? [];
        return ValidateAssetIds(assetIds);
    }

    GetAssetIds(scene) {
        const entityManager = scene?.EntityManager;
        if (
            !entityManager ||
            typeof entityManager.GetEntityIds !== "function" ||
            typeof entityManager.GetComponentEntries !== "function"
        ) {
            throw new TypeError("Component asset collection requires a scene.");
        }

        const assetIds = new Set();
        for (const entityId of entityManager.GetEntityIds()) {
            for (const { componentType, component } of
                entityManager.GetComponentEntries(entityId)) {
                for (const assetId of this.GetAssetIdsForComponent(
                    componentType,
                    component,
                    { scene, entityId },
                )) {
                    assetIds.add(assetId);
                }
            }
        }
        return [...assetIds];
    }

    GetAddable(entityManager, entityId) {
        return [...this._definitionsById.values()].filter(
            (definition) =>
                definition.create !== null &&
                !entityManager.HasComponent(entityId, definition.componentType) &&
                definition.requiredComponentTypes.every((requiredType) =>
                    entityManager.HasComponent(entityId, requiredType),
                ),
        );
    }

    async Create(typeId, context) {
        const definition = this.GetById(typeId);
        if (!definition?.create) {
            throw new Error("This component is not available to add.");
        }

        const component = await definition.create(context);
        if (!(component instanceof definition.componentType)) {
            throw new TypeError(
                `The ${definition.title} factory returned an invalid component.`,
            );
        }
        return component;
    }

    CanRemove(componentType, context) {
        const policy = this.GetByType(componentType)?.canRemove;
        if (policy === undefined || policy === false) {
            return false;
        }
        return typeof policy === "function" ? Boolean(policy(context)) : true;
    }
}

export function CreateEditorComponentAuthoringCatalog() {
    const catalog = new EditorComponentAuthoringCatalog();
    catalog.Register("transform", Transform, {
        title: "Transform",
        canRemove: false,
        inspector: TransformInspector,
    });
    catalog.Register("parent", Parent, {
        title: "Parent",
        canRemove: false,
        inspector: ParentInspector,
    });
    catalog.Register("angularVelocity", AngularVelocity, {
        title: "Angular Velocity",
        create: () => new AngularVelocity(),
        requiredComponentTypes: [Transform],
        inspector: AngularVelocityInspector,
    });
    catalog.Register("camera", Camera, {
        title: "Camera",
        create: () => new Camera(),
        canRemove: ({ scene, entityId }) =>
            scene.ActiveCameraEntityId !== entityId,
        requiredComponentTypes: [Transform],
        inspector: CameraInspector,
    });
    catalog.Register("cameraController", CameraController, {
        title: "Camera Controller",
        create: () =>
            new CameraController({
                movementSpeed: 4,
                runMultiplier: 2,
                lookSensitivity: 0.002,
                maxPitchRadians: Math.PI * 0.495,
            }),
        requiredComponentTypes: [Transform, Camera],
        inspector: CameraControllerInspector,
    });
    catalog.Register("meshRenderer", MeshRenderer, {
        title: "Mesh Renderer",
        create: CreateMeshRenderer,
        renderAddFields: RenderMeshRendererAddFields,
        requiredComponentTypes: [Transform],
        inspector: MeshRendererInspector,
    });
    catalog.Register("modelRenderer", ModelRenderer, {
        title: "Model Renderer",
        create: CreateModelRenderer,
        renderAddFields: RenderModelRendererAddFields,
        requiredComponentTypes: [Transform],
        inspector: ModelRendererInspector,
    });
    return catalog;
}
