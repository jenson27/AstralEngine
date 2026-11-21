function ValidateCallback(callback, label) {
    if (callback !== null && typeof callback !== "function") {
        throw new TypeError(`Inspector component ${label} must be a function.`);
    }
}

function ValidateDefinition(definition) {
    if (
        (definition.capture === null) !== (definition.restore === null) ||
        ((definition.apply !== null || definition.prepareApply !== null) &&
            definition.capture === null) ||
        (definition.apply !== null && definition.prepareApply !== null)
    ) {
        throw new TypeError(
            "Editable Inspector components must define capture and restore handlers.",
        );
    }
    if (typeof definition.canDisable !== "boolean") {
        throw new TypeError("Inspector component disable state must be a boolean.");
    }
    if (
        definition.refreshOnChange !== null &&
        (!Array.isArray(definition.refreshOnChange) ||
            !definition.refreshOnChange.every((fieldId) => typeof fieldId === "string"))
    ) {
        throw new TypeError("Inspector component refresh fields must be strings.");
    }
}

export class InspectorComponentRegistry {
    constructor() {
        this._definitionsByType = new Map();
    }

    Register(componentType, options = {}) {
        if (
            typeof componentType !== "function" ||
            !componentType.prototype
        ) {
            throw new TypeError("Inspector component type must be a class.");
        }

        const definition = {
            title: options.title,
            fieldPrefix: options.fieldPrefix ?? null,
            render: options.render ?? null,
            apply: options.apply ?? null,
            sync: options.sync ?? null,
            capture: options.capture ?? null,
            restore: options.restore ?? null,
            prepareApply: options.prepareApply ?? null,
            equals: options.equals ?? null,
            getEditLabel: options.getEditLabel ?? null,
            canDisable: options.canDisable ?? true,
            refreshOnChange: options.refreshOnChange ?? null,
            restoreInput: options.restoreInput ?? null,
            isEnabledToggleDisabled:
                options.isEnabledToggleDisabled ?? null,
        };

        if (typeof definition.title !== "string" || definition.title.trim() === "") {
            throw new TypeError("Inspector component title is required.");
        }
        if (
            definition.fieldPrefix !== null &&
            (typeof definition.fieldPrefix !== "string" ||
                definition.fieldPrefix === "")
        ) {
            throw new TypeError("Inspector component field prefix is invalid.");
        }

        for (const [key, label] of [
            ["render", "renderer"],
            ["apply", "editor"],
            ["prepareApply", "async preparation handler"],
            ["sync", "synchronizer"],
            ["capture", "capture handler"],
            ["restore", "restore handler"],
            ["equals", "equality handler"],
            ["getEditLabel", "edit label handler"],
            ["restoreInput", "input restore handler"],
            ["isEnabledToggleDisabled", "enabled toggle handler"],
        ]) {
            ValidateCallback(definition[key], label);
        }

        ValidateDefinition(definition);
        if (this._definitionsByType.has(componentType)) {
            throw new Error("Inspector component type is already registered.");
        }

        definition.title = definition.title.trim();
        this._definitionsByType.set(componentType, definition);
    }

    Get(componentType) {
        return this._definitionsByType.get(componentType);
    }
}
