// RenderSystem is the ECS system that turns entity components into things the renderer can draw.

import { Transform } from "../components/transform.js";
import { Camera } from "../components/graphics/camera.js";
import { DirectionalLight } from "../components/graphics/directional-light.js";
import { MeshRenderer } from "../components/graphics/mesh-renderer.js";
import { ModelRenderer } from "../components/graphics/model-renderer.js";
import { SpriteRenderer } from "../components/graphics/sprite-renderer.js";
import { SpriteAnimator } from "../components/graphics/sprite-animator.js";
import { MultiplyMatrix4 } from "../math/matrix4.js";

const DEFAULT_LIGHTING = Object.freeze({
    direction: Object.freeze([0.4, 0.8, 0.45]),
    color: Object.freeze([1, 1, 1]),
    intensity: 3,
});

function NormalizeVector3(vector, fallback) {
    const length = Math.hypot(vector[0], vector[1], vector[2]);
    if (!Number.isFinite(length) || length < 1e-8) {
        return [...fallback];
    }
    return vector.map((value) => value / length);
}

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
        const spriteRenderItems = [];

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

        const cameraWorld = cameraTransform.WorldMatrix;
        const cameraRight = NormalizeVector3(
            [cameraWorld[0], cameraWorld[1], cameraWorld[2]],
            [1, 0, 0],
        );
        const cameraUp = NormalizeVector3(
            [cameraWorld[4], cameraWorld[5], cameraWorld[6]],
            [0, 1, 0],
        );
        const cameraForward = NormalizeVector3(
            [-cameraWorld[8], -cameraWorld[9], -cameraWorld[10]],
            [0, 0, -1],
        );
        const cameraPosition = [
            cameraWorld[12],
            cameraWorld[13],
            cameraWorld[14],
        ];

        for (const entityId of scene.QueryActive(
            Transform,
            SpriteRenderer,
            SpriteAnimator,
        )) {
            const transform = entityManager.GetComponent(entityId, Transform);
            const spriteRenderer = entityManager.GetComponent(
                entityId,
                SpriteRenderer,
            );
            const animator = entityManager.GetComponent(
                entityId,
                SpriteAnimator,
            );
            const animation = animator.AnimationHandle.Current;
            const frameIndex = animator.CurrentFrameIndex;
            const modelMatrix = transform.WorldMatrix;
            let right = cameraRight;
            let up = cameraUp;
            if (spriteRenderer.billboardMode === "cylindrical") {
                right = NormalizeVector3(
                    [cameraRight[0], 0, cameraRight[2]],
                    [1, 0, 0],
                );
                up = [0, 1, 0];
            }
            const position = [modelMatrix[12], modelMatrix[13], modelMatrix[14]];
            const scaleX = Math.hypot(
                modelMatrix[0],
                modelMatrix[1],
                modelMatrix[2],
            );
            const scaleY = Math.hypot(
                modelMatrix[4],
                modelMatrix[5],
                modelMatrix[6],
            );
            const offset = [
                position[0] - cameraPosition[0],
                position[1] - cameraPosition[1],
                position[2] - cameraPosition[2],
            ];
            spriteRenderItems.push({
                entityId,
                texture: animation.Texture,
                uvRect: animation.GetFrameUv(frameIndex),
                position,
                right,
                up,
                width:
                    (animation.Grid.frameWidth / animation.PixelsPerUnit) *
                    scaleX,
                height:
                    (animation.Grid.frameHeight / animation.PixelsPerUnit) *
                    scaleY,
                pivot: animation.Pivot,
                tint: spriteRenderer.tint,
                renderOrder: spriteRenderer.renderOrder,
                depth:
                    offset[0] * cameraForward[0] +
                    offset[1] * cameraForward[1] +
                    offset[2] * cameraForward[2],
            });
        }
        spriteRenderItems.sort(
            (left, right) =>
                right.depth - left.depth ||
                left.renderOrder - right.renderOrder ||
                left.entityId.localeCompare(right.entityId),
        );

        let directionalLightId = null;
        for (const entityId of scene.QueryActive(DirectionalLight)) {
            directionalLightId = entityId;
            break;
        }
        const directionalLight = directionalLightId
            ? entityManager.GetComponent(directionalLightId, DirectionalLight)
            : DEFAULT_LIGHTING;
        this._renderer.SetRenderItems(
            renderItems,
            cameraMatrices.viewMatrix,
            cameraMatrices.projectionMatrix,
            {
                direction: directionalLight.Direction ?? directionalLight.direction,
                color: directionalLight.Color ?? directionalLight.color,
                intensity: directionalLight.Intensity ?? directionalLight.intensity,
                cameraPosition,
            },
            spriteRenderItems,
        );
    }
}
