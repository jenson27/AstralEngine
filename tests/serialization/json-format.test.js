import assert from "node:assert/strict";
import test from "node:test";
import { JsonFormat } from "../../src/serialization/json-format.js";

test("round-trips JSON-compatible document data", () => {
    const document = {
        name: "level",
        entityIds: [1, 4],
        enabled: true,
    };

    const text = JsonFormat.Stringify(document);

    assert.deepEqual(JsonFormat.Parse(text), document);
});

test("reports invalid JSON input with a useful error", () => {
    assert.throws(() => JsonFormat.Parse("{"), {
        name: "SyntaxError",
        message: "Invalid JSON document.",
    });
});

test("rejects a value that cannot produce JSON text", () => {
    assert.throws(
        () => JsonFormat.Stringify(undefined),
        /Value could not be encoded as JSON/,
    );
});
