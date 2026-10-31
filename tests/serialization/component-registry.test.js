import assert from "node:assert/strict";
import test from "node:test";
import { ComponentRegistry } from "../../src/core/ecs/component-registry.js";

class Counter {
    constructor(value) {
        this.value = value;
    }
}

test("creates current component data without applying old-version migrations", () => {
    const registry = new ComponentRegistry();
    let migrationCount = 0;

    registry.Register(
        "counter",
        Counter,
        (data) => new Counter(data.value),
        {
            Version: 2,
            Serialize: (counter) => ({ value: counter.value }),
            Migrate(data, fromVersion) {
                migrationCount += 1;

                if (fromVersion === 1) {
                    return { value: data.oldValue };
                }

                throw new Error("Unexpected migration version.");
            },
        },
    );

    const created = registry.CreateComponent("counter", { value: 7 });

    assert.ok(created.component instanceof Counter);
    assert.equal(created.component.value, 7);
    assert.equal(migrationCount, 0);

    const restored = registry.DeserializeComponent({
        typeId: "counter",
        version: 1,
        data: { oldValue: 5 },
    });

    assert.equal(restored.component.value, 5);
    assert.equal(migrationCount, 1);
});
