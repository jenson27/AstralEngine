import assert from "node:assert/strict";
import test from "node:test";
import { InputManager } from "../../../src/core/input/input-manager.js";

const actionMap = {
    version: 1,
    actions: {
        moveForward: {
            bindings: [
                { device: "keyboard", code: "KeyW" },
                { device: "keyboard", code: "ArrowUp" },
            ],
        },
        run: {
            bindings: [
                { device: "keyboard", code: "ShiftLeft" },
            ],
        },
    },
};

function CreateInputFrame({
    keysDown = [],
    keysPressed = [],
    keysReleased = [],
    pointerDeltaX = 0,
    pointerDeltaY = 0,
    isPointerLocked = false,
} = {}) {
    return {
        keysDown: new Set(keysDown),
        keysPressed: new Set(keysPressed),
        keysReleased: new Set(keysReleased),
        pointerDeltaX,
        pointerDeltaY,
        isPointerLocked,
    };
}

function CreateInputManager() {
    const frames = [];
    const inputSource = {
        ConsumeFrameInput: () =>
            frames.shift() ?? CreateInputFrame(),
    };

    return {
        manager: new InputManager(inputSource, actionMap),
        frames,
    };
}

test("maps alternative keyboard bindings to the same action", () => {
    const { manager, frames } = CreateInputManager();

    frames.push(
        CreateInputFrame({
            keysDown: ["ArrowUp"],
            keysPressed: ["ArrowUp"],
        }),
    );
    manager.Update();

    assert.equal(manager.IsActionDown("moveForward"), true);
    assert.equal(manager.WasActionPressed("moveForward"), true);
    assert.equal(manager.IsActionDown("run"), false);
});

test("reports press and release edges only in the consumed input frame", () => {
    const { manager, frames } = CreateInputManager();

    frames.push(
        CreateInputFrame({
            keysDown: ["KeyW"],
            keysPressed: ["KeyW"],
        }),
    );
    manager.Update();

    assert.equal(manager.WasActionPressed("moveForward"), true);
    assert.equal(manager.IsActionDown("moveForward"), true);

    frames.push(CreateInputFrame({ keysDown: ["KeyW"] }));
    manager.Update();

    assert.equal(manager.WasActionPressed("moveForward"), false);
    assert.equal(manager.IsActionDown("moveForward"), true);

    frames.push(CreateInputFrame({ keysReleased: ["KeyW"] }));
    manager.Update();

    assert.equal(manager.WasActionReleased("moveForward"), true);
    assert.equal(manager.IsActionDown("moveForward"), false);
});

test("exposes pointer movement and pointer-lock state", () => {
    const { manager, frames } = CreateInputManager();

    frames.push(
        CreateInputFrame({
            pointerDeltaX: 5,
            pointerDeltaY: -3,
            isPointerLocked: true,
        }),
    );
    manager.Update();

    assert.deepEqual(manager.GetPointerDelta(), { x: 5, y: -3 });
    assert.equal(manager.IsPointerLocked(), true);
});

test("rejects an unsupported action-map version and unknown actions", () => {
    const inputSource = {
        ConsumeFrameInput: () => CreateInputFrame(),
    };

    assert.throws(
        () =>
            new InputManager(inputSource, {
                version: 2,
                actions: {},
            }),
        /version 1/,
    );

    const { manager } = CreateInputManager();

    assert.throws(
        () => manager.IsActionDown("missingAction"),
        /not defined/,
    );
});
