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
        if (actionName.trim() === "" || !definition) {
            throw new TypeError(
                `Input action "${actionName}" must have at least one binding.`,
            );
        }

        const bindings = ValidateBindings(actionName, definition.bindings);
        actions.set(actionName, bindings);
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
    }

    Update() {
        this._frameInput = this._inputSource.ConsumeFrameInput();
    }

    IsActionDown(actionName) {
        return this._IsActionActive(actionName, "keysDown");
    }

    WasActionPressed(actionName) {
        return this._IsActionActive(actionName, "keysPressed");
    }

    WasActionReleased(actionName) {
        return this._IsActionActive(actionName, "keysReleased");
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
        const bindings = this._actions.get(actionName);

        if (!bindings) {
            throw new RangeError(
                `Input action "${actionName}" is not defined.`,
            );
        }

        return bindings.some((binding) =>
            this._frameInput[inputStateName].has(binding.code),
        );
    }
}
