function ValidateBindings(actionName, bindings) {
    if (!Array.isArray(bindings) || bindings.length === 0) {
        throw new TypeError(
            `Input action "${actionName}" must have at least one binding.`,
        );
    }

    return bindings.map((binding) => {
        if (
            !binding ||
            binding.device !== "keyboard" ||
            typeof binding.code !== "string" ||
            binding.code.trim() === ""
        ) {
            throw new TypeError(
                `Input action "${actionName}" has an invalid binding.`,
            );
        }

        return {
            device: binding.device,
            code: binding.code,
        };
    });
}

function ValidateActionDefinition(actionName, definition) {
    if (actionName.trim() === "" || !definition) {
        throw new TypeError(
            `Input action "${actionName}" must have at least one binding.`,
        );
    }

    return ValidateBindings(actionName, definition.bindings);
}

function ValidateActionMap(actionMap) {
    if (
        !actionMap ||
        actionMap.version !== 1 ||
        !actionMap.actions ||
        typeof actionMap.actions !== "object" ||
        Array.isArray(actionMap.actions)
    ) {
        throw new TypeError(
            "Input action map must have version 1 and an actions object.",
        );
    }

    const actions = new Map();

    for (const [actionName, definition] of Object.entries(
        actionMap.actions,
    )) {
        actions.set(
            actionName,
            ValidateActionDefinition(actionName, definition),
        );
    }

    if (actions.size === 0) {
        throw new TypeError("Input action map must define at least one action.");
    }

    return actions;
}

export class InputManager {
    constructor(inputSource, actionMap) {
        if (
            !inputSource ||
            typeof inputSource.ConsumeFrameInput !== "function"
        ) {
            throw new TypeError(
                "InputManager requires an input source with ConsumeFrameInput.",
            );
        }

        this._inputSource = inputSource;
        this._actions = ValidateActionMap(actionMap);
        this._frameInput = {
            keysDown: new Set(),
            keysPressed: new Set(),
            keysReleased: new Set(),
            pointerDeltaX: 0,
            pointerDeltaY: 0,
            isPointerLocked: false,
        };
        this._actionDownByName = new Map(
            [...this._actions.keys()].map((actionName) => [
                actionName,
                false,
            ]),
        );
        this._actionsPressed = new Set();
        this._actionsReleased = new Set();
    }

    Update() {
        const frameInput = this._inputSource.ConsumeFrameInput();
        const actionsPressed = new Set();
        const actionsReleased = new Set();

        for (const [actionName, bindings] of this._actions) {
            const wasDown = this._actionDownByName.get(actionName);
            const isDown = bindings.some(({ code }) =>
                frameInput.keysDown.has(code),
            );
            const hadPressEvent = bindings.some(({ code }) =>
                frameInput.keysPressed.has(code),
            );
            const hadReleaseEvent = bindings.some(({ code }) =>
                frameInput.keysReleased.has(code),
            );

            if (!wasDown && (isDown || hadPressEvent)) {
                actionsPressed.add(actionName);
            }

            if (
                !isDown &&
                (wasDown || (hadPressEvent && hadReleaseEvent))
            ) {
                actionsReleased.add(actionName);
            }

            this._actionDownByName.set(actionName, isDown);
        }

        this._frameInput = frameInput;
        this._actionsPressed = actionsPressed;
        this._actionsReleased = actionsReleased;
    }

    IsActionDown(actionName) {
        return this._IsActionActive(actionName, "keysDown");
    }

    WasActionPressed(actionName) {
        this._GetActionBindings(actionName);
        return this._actionsPressed.has(actionName);
    }

    WasActionReleased(actionName) {
        this._GetActionBindings(actionName);
        return this._actionsReleased.has(actionName);
    }

    GetPointerDelta() {
        return {
            x: this._frameInput.pointerDeltaX,
            y: this._frameInput.pointerDeltaY,
        };
    }

    IsPointerLocked() {
        return this._frameInput.isPointerLocked;
    }

    _IsActionActive(actionName, inputStateName) {
        const bindings = this._GetActionBindings(actionName);

        return bindings.some((binding) =>
            this._frameInput[inputStateName].has(binding.code),
        );
    }

    _GetActionBindings(actionName) {
        const bindings = this._actions.get(actionName);

        if (!bindings) {
            throw new RangeError(
                `Input action "${actionName}" is not defined.`,
            );
        }

        return bindings;
    }
}
