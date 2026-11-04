import assert from "node:assert/strict";
import test from "node:test";
import { Parent } from "../../src/components/parent.js";
import { CreateSceneComponentRegistry } from "../../src/components/register-scene-components.js";

const parentEntityId = "10203040-aaaa-4aaa-8aaa-102030405060";

test("requires a valid parent entity ID", () => {
    assert.throws(
        () => new Parent("invalid"),
        /valid parent entity ID/,
    );
});

test("serializes parent relationships as component version 1", () => {
    const registry = CreateSceneComponentRegistry();
    const { componentType, component } = registry.CreateComponent(
        "parent",
        { parentEntityId },
    );

    assert.equal(componentType, Parent);
    assert.equal(component.ParentEntityId, parentEntityId);
    assert.deepEqual(registry.SerializeComponent(component), {
        typeId: "parent",
        version: 1,
        data: { parentEntityId },
    });
});
