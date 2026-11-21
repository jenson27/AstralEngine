import assert from "node:assert/strict";
import test from "node:test";
import { Parent } from "../../src/components/parent.js";
import { CreateSceneComponentRegistry } from "../../src/components/register-scene-components.js";
import { Transform } from "../../src/components/transform.js";
import { SceneLoader } from "../../src/core/scene/scene-loader.js";
import { SystemPhase } from "../../src/core/scene/system-scheduler.js";
import { JsonFormat } from "../../src/serialization/json-format.js";
import { TransformHierarchySystem } from "../../src/systems/transform-hierarchy-system.js";

const cameraEntityId = "10203040-aaaa-4aaa-8aaa-102030405060";
const rootEntityId = "20304050-bbbb-4bbb-9bbb-203040506070";
const newParentEntityId = "30405060-cccc-4ccc-accc-304050607080";
const childEntityId = "40506070-dddd-4ddd-8ddd-405060708090";

function CreateTransformRecord(position) {
    return {
        typeId: "transform",
        version: 1,
        data: {
            position,
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
        },
    };
}

function CreateSceneDocument() {
    return {
        format: "astral-scene",
        version: 1,
        name: "hierarchy-integration-test",
        assets: [],
        activeCameraEntityId: cameraEntityId,
        entities: [
            {
                id: cameraEntityId,
                components: [
                    CreateTransformRecord([0, 0, 5]),
                    {
                        typeId: "camera",
                        version: 1,
                        data: {
                            fieldOfView: Math.PI / 3,
                            nearPlane: 0.1,
                            farPlane: 100,
                        },
                    },
                ],
            },
            {
                id: rootEntityId,
                components: [CreateTransformRecord([4, 0, 0])],
            },
            {
                id: newParentEntityId,
                components: [CreateTransformRecord([10, 0, 0])],
            },
            {
                id: childEntityId,
                components: [
                    CreateTransformRecord([2, 0, 0]),
                    {
                        typeId: "parent",
                        version: 1,
                        data: { parentEntityId: rootEntityId },
                    },
                ],
            },
        ],
    };
}

test("loads, reparents, renders, and cascade-deletes a version 1 hierarchy", () => {
    const componentRegistry = CreateSceneComponentRegistry();
    const sceneData = JsonFormat.Parse(
        JsonFormat.Stringify(CreateSceneDocument()),
    );
    const scene = new SceneLoader(componentRegistry).LoadData(sceneData, {
        systems: [
            {
                phase: SystemPhase.PrepareRender,
                system: new TransformHierarchySystem(),
            },
        ],
    });

    try {
        const entityManager = scene.EntityManager;
        const childTransform = entityManager.GetComponent(
            childEntityId,
            Transform,
        );
        const destroyedTransformEntityIds = [];

        entityManager.RegisterComponentRemovalHandler(
            Transform,
            ({ entityId }) => destroyedTransformEntityIds.push(entityId),
        );

        scene.PrepareRender(1, 1);
        assert.equal(childTransform.WorldMatrix[12], 6);
        assert.equal(scene.SetParent(childEntityId, newParentEntityId), true);

        scene.FixedUpdate(1 / 60, 1 / 60);
        scene.PrepareRender(1, 1);

        assert.equal(childTransform.WorldMatrix[12], 12);
        assert.deepEqual(childTransform.position, [2, 0, 0]);
        assert.equal(
            entityManager.GetComponent(childEntityId, Parent).ParentEntityId,
            newParentEntityId,
        );

        assert.equal(scene.DestroyEntity(newParentEntityId), true);
        scene.FixedUpdate(1 / 60, 2 / 60);

        assert.deepEqual(destroyedTransformEntityIds, [
            childEntityId,
            newParentEntityId,
        ]);
        assert.deepEqual(entityManager.GetEntityIds(), [
            cameraEntityId,
            rootEntityId,
        ]);
    } finally {
        scene.Dispose();
    }
});
