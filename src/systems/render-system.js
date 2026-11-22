// RenderSystem is the ECS system that turns entity components into things the renderer can draw.

import { Transform } from "../components/transform.js";
import { Camera } from "../components/graphics/camera.js";
import { MeshRenderer } from "../components/graphics/mesh-renderer.js";
import { ModelRenderer } from "../components/graphics/model-renderer.js";
import { MultiplyMatrix4 } from "../math/matrix4.js";

export class RenderSystem {
    constructor(renderer) {
        if (!renderer || typeof renderer.SetRenderItems !== "function") {
            throw new TypeError(
                "RenderSystem requires a renderer with SetRenderItems.",
            );
        }

        this._renderer = renderer;
    }

    PrepareRender(scene, { aspectRatio, profiler }) {
        const entityManager = scene.EntityManager;
        const cameraEntity = scene.ActiveCameraEntityId;
        const camera = entityManager.GetComponent(cameraEntity, Camera);
        const cameraTransform = entityManager.GetComponent(
            cameraEntity,
            Transform,
        );

        if (!camera || !cameraTransform) {
            throw new Error(
                "The active camera entity needs Camera and Transform.",
            );
        }

        const cameraMatrices = camera.UpdateMatricesFromWorldMatrix(
            cameraTransform.WorldMatrix,
            aspectRatio,
        );
        const renderItems = [];

        for (const entityId of scene.QueryActive(Transform, MeshRenderer)) {
            const transform = entityManager.GetComponent(entityId, Transform);
            const meshRenderer = entityManager.GetComponent(
                entityId,
                MeshRenderer,
            );

            renderItems.push({
                mesh: meshRenderer.mesh,
                materialsBySlot: meshRenderer.MaterialsBySlot,
                modelMatrix: transform.WorldMatrix,
            });
        }

        for (const entityId of scene.QueryActive(Transform, ModelRenderer)) {
            const transform = entityManager.GetComponent(entityId, Transform);
            const modelRenderer = entityManager.GetComponent(
                entityId,
                ModelRenderer,
            );

            const profilerScope = profiler?.BeginScope(
                `ModelRenderer:${modelRenderer.ModelHandle.AssetId}`,
                "asset",
            ) ?? null;
            try {
                for (const primitive of modelRenderer.Model.Primitives) {
                    const modelMatrix = new Float32Array(16);
                    MultiplyMatrix4(
                        modelMatrix,
                        transform.WorldMatrix,
                        primitive.transform,
                    );
                    renderItems.push({
                        mesh: primitive.mesh,
                        materialsBySlot: { default: primitive.material },
                        modelMatrix,
                    });
                }
            } finally {
                profiler?.EndScope(profilerScope);
            }
        }

        this._renderer.SetRenderItems(
            renderItems,
            cameraMatrices.viewMatrix,
            cameraMatrices.projectionMatrix,
        );
    }
}
