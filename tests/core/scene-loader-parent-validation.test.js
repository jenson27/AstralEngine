import assert from "node:assert/strict";
import test from "node:test";
import { Parent } from "../../src/components/parent.js";
import { CreateSceneComponentRegistry } from "../../src/components/register-scene-components.js";
import { SceneLoader } from "../../src/core/scene-loader.js";

const cameraEntityId = "10203040-aaaa-4aaa-8aaa-102030405060";
const rootEntityId = "20304050-bbbb-4bbb-9bbb-203040506070";
const childEntityId = "30405060-cccc-4ccc-accc-304050607080";
const otherEntityId = "40506070-dddd-4ddd-8ddd-405060708090";

function CreateTransformRecord() {
    return {
        typeId: "transform",
        version: 1,
        data: {
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
        },
    };
}

function CreateParentRecord(parentEntityId) {
    return {
        typeId: "parent",
        version: 1,
        data: { parentEntityId },
    };
}

function CreateCameraEntity() {
    return {
        id: cameraEntityId,
        components: [
            CreateTransformRecord(),
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
    };
}

function CreateSceneData(entities, assets = []) {
    return {
        format: "astral-scene",
        version: 1,
        name: "parent-validation-test",
        assets,
        activeCameraEntityId: cameraEntityId,
        entities,
    };
}

function CreateSceneLoader() {
    return new SceneLoader(CreateSceneComponentRegistry());
}

test("accepts a parent declared after its child", () => {
    const scene = CreateSceneLoader().LoadData(
        CreateSceneData([
            {
                id: childEntityId,
                components: [
                    CreateTransformRecord(),
                    CreateParentRecord(rootEntityId),
                ],
            },
            {
                id: rootEntityId,
                components: [CreateTransformRecord()],
            },
            CreateCameraEntity(),
        ]),
    );

    try {
        const parent = scene.EntityManager.GetComponent(
            childEntityId,
            Parent,
        );

        assert.equal(parent.ParentEntityId, rootEntityId);
    } finally {
        scene.Dispose();
    }
});

test("rejects a missing parent before acquiring scene assets", async () => {
    const data = CreateSceneData(
        [
            CreateCameraEntity(),
            {
                id: childEntityId,
                components: [
                    CreateTransformRecord(),
                    CreateParentRecord(otherEntityId),
                ],
            },
        ],
        ["test:asset"],
    );
    let acquisitionCount = 0;

    await assert.rejects(
        CreateSceneLoader().LoadDataAsync(data, {
            assetScope: {
                Acquire() {
                    acquisitionCount += 1;
                    return Promise.resolve();
                },
            },
        }),
        /must reference an existing entity ID/,
    );

    assert.equal(acquisitionCount, 0);
});

test("rejects an invalid active camera before acquiring scene assets", async () => {
    const missingCameraData = CreateSceneData(
        [
            {
                id: rootEntityId,
                components: [CreateTransformRecord()],
            },
        ],
        ["test:asset"],
    );
    const missingCameraComponentData = {
        ...CreateSceneData(
            [
                {
                    id: rootEntityId,
                    components: [CreateTransformRecord()],
                },
            ],
            ["test:asset"],
        ),
        activeCameraEntityId: rootEntityId,
    };
    let acquisitionCount = 0;
    const options = {
        assetScope: {
            Acquire() {
                acquisitionCount += 1;
                return Promise.resolve();
            },
        },
    };
    const loader = CreateSceneLoader();

    await assert.rejects(
        loader.LoadDataAsync(missingCameraData, options),
        /Active camera entity does not exist/,
    );
    await assert.rejects(
        loader.LoadDataAsync(missingCameraComponentData, options),
        /must have Camera and Transform components/,
    );

    assert.equal(acquisitionCount, 0);
});

test("requires a Transform on the child and parent entities", () => {
    const childWithoutTransform = CreateSceneData([
        CreateCameraEntity(),
        {
            id: childEntityId,
            components: [CreateParentRecord(rootEntityId)],
        },
        {
            id: rootEntityId,
            components: [CreateTransformRecord()],
        },
    ]);

    assert.throws(
        () => CreateSceneLoader().LoadData(childWithoutTransform),
        /with a Parent component must have a Transform component/,
    );

    const parentWithoutTransform = CreateSceneData([
        CreateCameraEntity(),
        {
            id: childEntityId,
            components: [
                CreateTransformRecord(),
                CreateParentRecord(rootEntityId),
            ],
        },
        {
            id: rootEntityId,
            components: [],
        },
    ]);

    assert.throws(
        () => CreateSceneLoader().LoadData(parentWithoutTransform),
        /must have a Transform component/,
    );
});

test("rejects parent cycles", () => {
    const data = CreateSceneData([
        CreateCameraEntity(),
        {
            id: rootEntityId,
            components: [
                CreateTransformRecord(),
                CreateParentRecord(childEntityId),
            ],
        },
        {
            id: childEntityId,
            components: [
                CreateTransformRecord(),
                CreateParentRecord(rootEntityId),
            ],
        },
    ]);

    assert.throws(
        () => CreateSceneLoader().LoadData(data),
        /Parent hierarchy contains a cycle/,
    );
});
