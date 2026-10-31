function ValidateJsonValue(value, path = "$", ancestors = new Set()) {
    const valueType = typeof value;

    if (
        value === null ||
        valueType === "string" ||
        valueType === "boolean"
    ) {
        return;
    }

    if (valueType === "number") {
        if (!Number.isFinite(value) || Object.is(value, -0)) {
            throw new TypeError(
                `Number cannot be represented without change at ${path}.`,
            );
        }

        return;
    }

    if (valueType !== "object") {
        throw new TypeError(
            `Unsupported JSON value at ${path}: ${valueType}.`,
        );
    }

    if (ancestors.has(value)) {
        throw new TypeError(`Circular reference at ${path}.`);
    }

    const isArray = Array.isArray(value);

    if (!isArray) {
        const prototype = Object.getPrototypeOf(value);

        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError(
                `Expected a plain object at ${path}.`,
            );
        }
    }

    if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new TypeError(`Symbol property found at ${path}.`);
    }

    ancestors.add(value);

    try {
        if (isArray) {
            for (const key of Object.getOwnPropertyNames(value)) {
                if (key === "length") {
                    continue;
                }

                const index = Number(key);
                if (
                    !Number.isInteger(index) ||
                    index < 0 ||
                    index >= value.length ||
                    String(index) !== key
                ) {
                    throw new TypeError(
                        `Non-index array property found at ${path}[${key}].`,
                    );
                }
            }

            for (let index = 0; index < value.length; index++) {
                const itemPath = `${path}[${index}]`;

                if (!Object.hasOwn(value, index)) {
                    throw new TypeError(`Sparse array item at ${itemPath}.`);
                }

                const descriptor = Object.getOwnPropertyDescriptor(
                    value,
                    String(index),
                );

                if (!descriptor || !Object.hasOwn(descriptor, "value")) {
                    throw new TypeError(
                        `Accessor property found at ${itemPath}.`,
                    );
                }

                ValidateJsonValue(descriptor.value, itemPath, ancestors);
            }

            return;
        }

        for (const key of Object.getOwnPropertyNames(value)) {
            const propertyPath = `${path}[${JSON.stringify(key)}]`;
            const descriptor = Object.getOwnPropertyDescriptor(value, key);

            if (!descriptor.enumerable) {
                throw new TypeError(
                    `Non-enumerable property found at ${propertyPath}.`,
                );
            }

            if (!Object.hasOwn(descriptor, "value")) {
                throw new TypeError(
                    `Accessor property found at ${propertyPath}.`,
                );
            }

            ValidateJsonValue(
                descriptor.value,
                propertyPath,
                ancestors,
            );
        }
    } finally {
        ancestors.delete(value);
    }
}

export class JsonFormat {
    static Parse(text) {
        if (typeof text !== "string") {
            throw new TypeError("JSON input must be a string.");
        }

        try {
            return JSON.parse(text);
        } catch (error) {
            const parseError = new SyntaxError("Invalid JSON document.");
            parseError.cause = error;
            throw parseError;
        }
    }

    static Stringify(value, space = 2) {
        try {
            ValidateJsonValue(value);

            const text = JSON.stringify(value, null, space);
            if (text === undefined) {
                throw new TypeError("Value cannot be represented as JSON.");
            }

            return text;
        } catch (error) {
            const reason =
                error instanceof Error ? error.message : String(error);
            const stringifyError = new TypeError(
                `Value could not be encoded as JSON: ${reason}`,
            );
            stringifyError.cause = error;
            throw stringifyError;
        }
    }
}
