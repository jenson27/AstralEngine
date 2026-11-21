import { AngularVelocity } from "../components/angular-velocity.js";
import { CameraController } from "../components/graphics/camera-controller.js";
import { Camera } from "../components/graphics/camera.js";
import { MeshRenderer } from "../components/graphics/mesh-renderer.js";
import { Parent } from "../components/parent.js";
import { Transform } from "../components/transform.js";
import {
    CreateMeshRenderer,
    RenderMeshRendererAddFields,
} from "./component-authoring/mesh-renderer-authoring.js";

export class EditorComponentAuthoringCatalog {
    constructor() {
        this._definitionsById = new Map();
        this._definitionsByType = new Map();
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
        if (
            this._definitionsById.has(normalizedTypeId) ||
            this._definitionsByType.has(componentType)
        ) {
            throw new Error("Component authoring definition is already registered.");
        }

        const definition = {
            typeId: normalizedTypeId,
            componentType,
            title: title.trim(),
            create,
            renderAddFields,
            canRemove,
            requiredComponentTypes: [...requiredComponentTypes],
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
    });
    catalog.Register("parent", Parent, {
        title: "Parent",
        canRemove: false,
    });
    catalog.Register("angularVelocity", AngularVelocity, {
        title: "Angular Velocity",
        create: () => new AngularVelocity(),
        requiredComponentTypes: [Transform],
    });
    catalog.Register("camera", Camera, {
        title: "Camera",
        create: () => new Camera(),
        canRemove: ({ scene, entityId }) =>
            scene.ActiveCameraEntityId !== entityId,
        requiredComponentTypes: [Transform],
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
    });
    catalog.Register("meshRenderer", MeshRenderer, {
        title: "Mesh Renderer",
        create: CreateMeshRenderer,
        renderAddFields: RenderMeshRendererAddFields,
        requiredComponentTypes: [Transform],
    });
    return catalog;
}
