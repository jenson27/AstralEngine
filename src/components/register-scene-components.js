import { ComponentRegistry } from "../core/ecs/component-registry.js";
import { Transform } from "./transform.js";
import { Camera } from "./graphics/camera.js";
import { MeshRenderer } from "./graphics/mesh-renderer.js";
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

function ValidateCameraSettings(camera) {
    if (
        !Number.isFinite(camera.fieldOfView) ||
        camera.fieldOfView <= 0 ||
        camera.fieldOfView >= Math.PI ||
        !Number.isFinite(camera.nearPlane) ||
        camera.nearPlane <= 0 ||
        !Number.isFinite(camera.farPlane) ||
        camera.farPlane <= camera.nearPlane
    ) {
        throw new RangeError("Camera settings are invalid.");
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
            camera.fieldOfView = data.fieldOfView;
            camera.nearPlane = data.nearPlane;
            camera.farPlane = data.farPlane;

            ValidateCameraSettings(camera);
            return camera;
        },
        {
            Version: 1,
            Serialize: (camera) => {
                ValidateCameraSettings(camera);
                return {
                    fieldOfView: camera.fieldOfView,
                    nearPlane: camera.nearPlane,
                    farPlane: camera.farPlane,
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
            Version: 2,
            Migrate: (data, fromVersion) => {
                if (fromVersion !== 1) {
                    throw new Error(
                        "Unsupported mesh renderer component version.",
                    );
                }

                return {
                    meshAssetId: data.meshAssetId,
                    defaultMaterialAssetId: data.materialAssetId,
                };
            },
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

    return registry;
}
