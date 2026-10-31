import assert from "node:assert/strict";
import test from "node:test";
import { Engine } from "../src/core/engine.js";
import { AstralLogger } from "../src/diagnostics/logger.js";

function InstallAnimationFrameMock(testContext) {
    const callbacks = new Map();
    let nextId = 1;

    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

    globalThis.requestAnimationFrame = (callback) => {
        const id = nextId++;
        callbacks.set(id, callback);
        return id;
    };

    globalThis.cancelAnimationFrame = (id) => {
        callbacks.delete(id);
    };

    testContext.after(() => {
        if (originalRequestAnimationFrame === undefined) {
            delete globalThis.requestAnimationFrame;
        } else {
            globalThis.requestAnimationFrame = originalRequestAnimationFrame;
        }

        if (originalCancelAnimationFrame === undefined) {
            delete globalThis.cancelAnimationFrame;
        } else {
            globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
        }
    });

    return {
        RunNext(timestamp) {
            const nextFrame = callbacks.entries().next();

            if (nextFrame.done) {
                throw new Error("No animation frame is scheduled.");
            }

            const [id, callback] = nextFrame.value;
            callbacks.delete(id);
            callback(timestamp);
        },

        get PendingCount() {
            return callbacks.size;
        },
    };
}

test("updates and renders each frame with a capped delta time", (testContext) => {
    const animationFrame = InstallAnimationFrameMock(testContext);
    const calls = [];
    const originalWarn = AstralLogger.Warn;
    const warnings = [];

    AstralLogger.Warn = (message, details) => {
        warnings.push({ message, details });
    };
    testContext.after(() => {
        AstralLogger.Warn = originalWarn;
    });

    const engine = new Engine(
        {
            Render: () => calls.push(["render"]),
        },
        (deltaTime, elapsedTime) =>
            calls.push(["update", deltaTime, elapsedTime]),
        () => calls.push(["prepare"]),
    );

    engine.Start();
    engine.Start();

    assert.equal(animationFrame.PendingCount, 1);

    animationFrame.RunNext(1000);
    animationFrame.RunNext(1500);

    assert.equal(warnings.length, 1);
    assert.match(warnings[0].message, /dropped simulation time/);
    assert.equal(warnings[0].details.droppedSteps, 1);

    assert.deepEqual(calls, [
        ["prepare"],
        ["render"],
        ["update", 1 / 60, 1 / 60],
        ["update", 1 / 60, 2 / 60],
        ["update", 1 / 60, 3 / 60],
        ["update", 1 / 60, 4 / 60],
        ["update", 1 / 60, 5 / 60],
        ["prepare"],
        ["render"],
    ]);

    engine.Stop();

    assert.equal(engine.IsRunning, false);
    assert.equal(animationFrame.PendingCount, 0);
});

test("requires a renderer with a Render method", () => {
    assert.throws(
        () => new Engine({}),
        /requires a renderer with a Render method/,
    );
});

test("requires update and render preparation callbacks", () => {
    const renderer = { Render() {} };

    assert.throws(
        () => new Engine(renderer, null),
        /update callback must be a function/,
    );

    assert.throws(
        () => new Engine(renderer, () => {}, null),
        /render preparation callback must be a function/,
    );
});
