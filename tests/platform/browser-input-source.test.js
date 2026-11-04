import assert from "node:assert/strict";
import test from "node:test";
import { BrowserInputSource } from "../../src/platform/browser-input-source.js";

class EventTargetStub {
    constructor() {
        this._listeners = new Map();
    }

    addEventListener(type, listener) {
        const listeners = this._listeners.get(type) ?? new Set();
        listeners.add(listener);
        this._listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
        this._listeners.get(type)?.delete(listener);
    }

    Dispatch(type, event = {}) {
        for (const listener of this._listeners.get(type) ?? []) {
            listener(event);
        }
    }
}

function CreateBrowserInputHarness() {
    const window = new EventTargetStub();
    const document = new EventTargetStub();
    const canvas = new EventTargetStub();

    document.defaultView = window;
    document.visibilityState = "visible";
    document.activeElement = null;
    document.pointerLockElement = null;
    document.exitPointerLock = () => {
        document.pointerLockElement = null;
        document.Dispatch("pointerlockchange");
    };

    canvas.ownerDocument = document;
    canvas.focus = () => {
        document.activeElement = canvas;
    };
    canvas.requestPointerLock = () => {
        document.pointerLockElement = canvas;
        document.Dispatch("pointerlockchange");
    };

    return {
        source: new BrowserInputSource(canvas),
        canvas,
        document,
        window,
    };
}

test("captures keyboard and pointer input while the canvas has focus", () => {
    const { source, canvas, document, window } =
        CreateBrowserInputHarness();

    source.Start();
    canvas.Dispatch("pointerdown");
    window.Dispatch("keydown", { code: "KeyW" });
    document.Dispatch("mousemove", {
        movementX: 7,
        movementY: -4,
    });

    const pressedInput = source.ConsumeFrameInput();

    assert.equal(pressedInput.keysDown.has("KeyW"), true);
    assert.equal(pressedInput.keysPressed.has("KeyW"), true);
    assert.equal(pressedInput.isPointerLocked, true);
    assert.equal(pressedInput.pointerDeltaX, 7);
    assert.equal(pressedInput.pointerDeltaY, -4);

    window.Dispatch("keyup", { code: "KeyW" });

    const releasedInput = source.ConsumeFrameInput();

    assert.equal(releasedInput.keysDown.has("KeyW"), false);
    assert.equal(releasedInput.keysReleased.has("KeyW"), true);

    document.exitPointerLock();

    assert.equal(source.ConsumeFrameInput().isPointerLocked, false);
    source.Stop();
});

test("releases held keys when the browser window loses focus", () => {
    const { source, canvas, window } = CreateBrowserInputHarness();

    source.Start();
    canvas.focus();
    window.Dispatch("keydown", { code: "KeyW" });
    window.Dispatch("blur");

    const frameInput = source.ConsumeFrameInput();

    assert.equal(frameInput.keysDown.has("KeyW"), false);
    assert.equal(frameInput.keysReleased.has("KeyW"), true);

    source.Stop();
});
