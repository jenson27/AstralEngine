import assert from "node:assert/strict";
import test from "node:test";
import { TypeSerializerRegistry } from "../../src/serialization/type-serializer-registry.js";

class Counter {
    constructor(value) {
        this.value = value;
    }
}

test("serializes and deserializes a registered type", () => {
    const registry = new TypeSerializerRegistry();
    registry.Register("counter", Counter, {
        Version: 1,
        Serialize: (counter) => ({ value: counter.value }),
        Deserialize: (data) => new Counter(data.value),
    });

    const record = registry.Serialize(new Counter(12));
    const restoredCounter = registry.Deserialize(record);

    assert.deepEqual(record, {
        typeId: "counter",
        version: 1,
        data: { value: 12 },
    });
    assert.ok(restoredCounter instanceof Counter);
    assert.equal(restoredCounter.value, 12);
});

test("migrates older type data one version at a time", () => {
    const registry = new TypeSerializerRegistry();
    registry.Register("counter", Counter, {
        Version: 3,
        Serialize: (counter) => ({ value: counter.value }),
        Deserialize: (data) => new Counter(data.value),
        Migrate(data, fromVersion) {
            if (fromVersion === 1) {
                return { count: data.oldCount };
            }

            if (fromVersion === 2) {
                return { value: data.count };
            }

            throw new Error("Unexpected migration version.");
        },
    });

    const restoredCounter = registry.Deserialize({
        typeId: "counter",
        version: 1,
        data: { oldCount: 7 },
    });

    assert.ok(restoredCounter instanceof Counter);
    assert.equal(restoredCounter.value, 7);
});

test("rejects unknown types and unsupported future versions", () => {
    const registry = new TypeSerializerRegistry();
    registry.Register("counter", Counter, {
        Version: 1,
        Serialize: (counter) => ({ value: counter.value }),
        Deserialize: (data) => new Counter(data.value),
    });

    assert.throws(
        () =>
            registry.Deserialize({
                typeId: "unknown",
                version: 1,
                data: {},
            }),
        /Unknown serialized type ID/,
    );
    assert.throws(
        () =>
            registry.Deserialize({
                typeId: "counter",
                version: 2,
                data: { value: 1 },
            }),
        /newer unsupported version/,
    );
});
