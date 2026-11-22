import { ComponentRegistry } from "../core/ecs/component-registry.js";
import { Transform } from "./transform.js";
import { Parent } from "./parent.js";
import { Camera, ValidateCameraSettings } from "./graphics/camera.js";
import {
    CameraController,
    ValidateCameraControllerSettings,
} from "./graphics/camera-controller.js";
import { MeshRenderer } from "./graphics/mesh-renderer.js";
import { ModelRenderer } from "./graphics/model-renderer.js";
import { AngularVelocity } from "./angular-velocity.js";

function ReadVector3(value, name) {
    if (
        !Array.isArray(value) ||
        value.length !== 3 ||
        !value.every(Number.isFinite)
    ) {
        throw new TypeError(name + " must contain three finite numbers.");
    }

    return [...value];
}

function ValidateAngularVelocity(angularVelocity) {
    if (
        ![
            angularVelocity.x,
            angularVelocity.y,
            angularVelocity.z,
        ].every(Number.isFinite)
    ) {
        throw new TypeError("Angular velocity values must be finite.");
    }
}

export function CreateSceneComponentRegistry() {
    const registry = new ComponentRegistry();

    registry.Register(
        "transform",
        Transform,
        (data) => {
            const transform = new Transform();
            transform.position = ReadVector3(
                data.position,
                "Transform position",
            );
            transform.rotation = ReadVector3(
                data.rotation,
                "Transform rotation",
            );
            transform.scale = ReadVector3(data.scale, "Transform scale");
            return transform;
        },
        {
            Version: 1,
            Serialize: (transform) => ({
                position: ReadVector3(
                    transform.position,
                    "Transform position",
                ),
                rotation: ReadVector3(
                    transform.rotation,
                    "Transform rotation",
                ),
                scale: ReadVector3(transform.scale, "Transform scale"),
            }),
        },
    );

    registry.Register(
        "parent",
        Parent,
        (data) => new Parent(data.parentEntityId),
        {
            Version: 1,
            Serialize: (parent) => ({
                parentEntityId: parent.ParentEntityId,
            }),
        },
    );

    registry.Register(
        "angularVelocity",
        AngularVelocity,
        (data) => new AngularVelocity(data.x, data.y, data.z),
        {
            Version: 1,
            Serialize: (angularVelocity) => {
                ValidateAngularVelocity(angularVelocity);
                return {
                    x: angularVelocity.x,
                    y: angularVelocity.y,
                    z: angularVelocity.z,
                };
            },
        },
    );

    registry.Register(
        "camera",
        Camera,
        (data) => {
            const camera = new Camera();
            camera.SetSettings({
                projectionType: data.projectionType ?? "perspective",
                fieldOfView: data.fieldOfView,
                orthographicSize: data.orthographicSize ?? 5,
                nearPlane: data.nearPlane,
                farPlane: data.farPlane,
            });

            return camera;
        },
        {
            Version: 1,
            Serialize: (camera) => {
                ValidateCameraSettings(camera);
                return {
                    projectionType: camera.projectionType,
                    fieldOfView: camera.fieldOfView,
                    orthographicSize: camera.orthographicSize,
                    nearPlane: camera.nearPlane,
                    farPlane: camera.farPlane,
                };
            },
        },
    );

    registry.Register(
        "cameraController",
        CameraController,
        (data) => new CameraController(data),
        {
            Version: 1,
            Serialize: (cameraController) => {
                ValidateCameraControllerSettings(cameraController);
                return {
                    movementSpeed: cameraController.movementSpeed,
                    runMultiplier: cameraController.runMultiplier,
                    lookSensitivity: cameraController.lookSensitivity,
                    maxPitchRadians: cameraController.maxPitchRadians,
                };
            },
        },
    );

    registry.Register(
        "meshRenderer",
        MeshRenderer,
        (data, context) => {
            const resolveMeshHandle = context.RequireService(
                "ResolveMeshHandle",
            );
            const resolveMaterialHandle = context.RequireService(
                "ResolveMaterialHandle",
            );
            const meshHandle = resolveMeshHandle(data.meshAssetId);
            const mesh = meshHandle.Current;
            let materialHandlesBySlot;

            if (data.defaultMaterialAssetId !== undefined) {
                const defaultMaterialHandle = resolveMaterialHandle(
                    data.defaultMaterialAssetId,
                );
                materialHandlesBySlot = Object.fromEntries(
                    mesh.Submeshes.map(({ materialSlot }) => [
                        materialSlot,
                        defaultMaterialHandle,
                    ]),
                );
            } else {
                if (
                    !data.materialsBySlot ||
                    typeof data.materialsBySlot !== "object" ||
                    Array.isArray(data.materialsBySlot)
                ) {
                    throw new TypeError(
                        "Mesh renderer data must define materialsBySlot.",
                    );
                }

                materialHandlesBySlot = Object.fromEntries(
                    Object.entries(data.materialsBySlot).map(
                        ([materialSlot, materialAssetId]) => [
                            materialSlot,
                            resolveMaterialHandle(materialAssetId),
                        ],
                    ),
                );
            }

            return new MeshRenderer(meshHandle, materialHandlesBySlot);
        },
        {
            Version: 1,
            Serialize: (meshRenderer) => {
                const meshAssetId = meshRenderer.MeshHandle.AssetId;

                if (
                    typeof meshAssetId !== "string" ||
                    meshAssetId.trim() === ""
                ) {
                    throw new TypeError(
                        "Mesh asset serializer must return a non-empty ID.",
                    );
                }

                const materialsBySlot = {};

                for (const { materialSlot } of meshRenderer.mesh.Submeshes) {
                    const materialAssetId = meshRenderer
                        .GetMaterialHandleForSlot(materialSlot)
                        .AssetId;

                    if (
                        typeof materialAssetId !== "string" ||
                        materialAssetId.trim() === ""
                    ) {
                        throw new TypeError(
                            "Material asset serializer must return a non-empty ID.",
                        );
                    }

                    materialsBySlot[materialSlot] = materialAssetId;
                }

                return { meshAssetId, materialsBySlot };
            },
        },
    );

    registry.Register(
        "modelRenderer",
        ModelRenderer,
        (data, context) => {
            const resolveModelHandle = context.RequireService(
                "ResolveModelHandle",
            );
            return new ModelRenderer(resolveModelHandle(data.modelAssetId));
        },
        {
            Version: 1,
            Serialize: (modelRenderer) => {
                const modelAssetId = modelRenderer.ModelHandle.AssetId;
                if (
                    typeof modelAssetId !== "string" ||
                    modelAssetId.trim() === ""
                ) {
                    throw new TypeError(
                        "Model asset serializer must return a non-empty ID.",
                    );
                }

                return { modelAssetId };
            },
        },
    );

    return registry;
}
