// RenderSystem is the ECS system that turns entity components into things the renderer can draw.

import { Transform } from "../components/transform.js";
import { Camera } from "../components/graphics/camera.js";
import { MeshRenderer } from "../components/graphics/mesh-renderer.js";

export class RenderSystem {
    constructor(renderer) {
        if (!renderer || typeof renderer.SetRenderItems !== "function") {
            throw new TypeError(
                "RenderSystem requires a renderer with SetRenderItems.",
            );
        }

        this._renderer = renderer;
    }

    PrepareRender(scene, { aspectRatio }) {
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

        const cameraMatrices = camera.UpdateMatrices(
            cameraTransform,
            aspectRatio,
        );
        const renderItems = [];

        for (const entityId of entityManager.Query(Transform, MeshRenderer)) {
            const transform = entityManager.GetComponent(entityId, Transform);
            const meshRenderer = entityManager.GetComponent(
                entityId,
                MeshRenderer,
            );

            renderItems.push({
                mesh: meshRenderer.mesh,
                materialsBySlot: meshRenderer.MaterialsBySlot,
                modelMatrix: transform.GetModelMatrix(),
            });
        }

        this._renderer.SetRenderItems(
            renderItems,
            cameraMatrices.viewMatrix,
            cameraMatrices.projectionMatrix,
        );
    }
}
