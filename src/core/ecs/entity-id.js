const ENTITY_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function CreateEntityId() {
    if (typeof globalThis.crypto?.randomUUID !== "function") {
        throw new Error("UUID generation is not available.");
    }

    return globalThis.crypto.randomUUID();
}

export function IsEntityId(value) {
    return typeof value === "string" && ENTITY_ID_PATTERN.test(value);
}
