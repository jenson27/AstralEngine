import { SerializationContext } from "./serialization-context.js";

export class TypeSerializerRegistry {
    constructor() {
        this._registrationsById = new Map();
        this._registrationsByType = new Map();
    }

    Register(
        typeId,
        runtimeType,
        { Version = 1, Serialize, Deserialize, Migrate } = {},
    ) {
        if (typeof typeId !== "string" || typeId.trim() === "") {
            throw new TypeError("Serializer type ID must be a non-empty string.");
        }

        if (typeof runtimeType !== "function" || !runtimeType.prototype) {
            throw new TypeError("Serializer runtime type must be a class.");
        }

        if (!Number.isSafeInteger(Version) || Version <= 0) {
            throw new TypeError(
                "Serializer version must be a positive integer.",
            );
        }

        if (typeof Serialize !== "function") {
            throw new TypeError("Serializer requires a Serialize function.");
        }

        if (typeof Deserialize !== "function") {
            throw new TypeError("Serializer requires a Deserialize function.");
        }

        if (Migrate !== undefined && typeof Migrate !== "function") {
            throw new TypeError("Serializer Migrate must be a function.");
        }

        if (this._registrationsById.has(typeId)) {
            throw new Error("Serializer type ID is already registered: " + typeId);
        }

        if (this._registrationsByType.has(runtimeType)) {
            throw new Error("Runtime type is already registered.");
        }

        const registration = {
            typeId,
            runtimeType,
            Version,
            Serialize,
            Deserialize,
            Migrate,
        };

        this._registrationsById.set(typeId, registration);
        this._registrationsByType.set(runtimeType, registration);
    }

    GetRuntimeType(typeId) {
        const registration = this._registrationsById.get(typeId);
        if (!registration) {
            throw new Error("Unknown serializer type ID: " + typeId);
        }

        return registration.runtimeType;
    }

    Serialize(value, context = {}) {
        if (!value || typeof value !== "object") {
            throw new TypeError("Only registered objects can be serialized.");
        }

        const registration = this._registrationsByType.get(value.constructor);
        if (!registration) {
            throw new Error(
                "No serializer registered for " + value.constructor.name,
            );
        }

        const data = registration.Serialize(
            value,
            SerializationContext.From(context),
        );
        if (data === undefined) {
            throw new TypeError(
                "Serializer returned undefined for " + registration.typeId,
            );
        }

        return {
            typeId: registration.typeId,
            version: registration.Version,
            data,
        };
    }

    Deserialize(record, context = {}) {
        if (!record || typeof record !== "object" || Array.isArray(record)) {
            throw new TypeError("Serialized record must be an object.");
        }

        const registration = this._registrationsById.get(record.typeId);
        if (!registration) {
            throw new Error("Unknown serialized type ID: " + record.typeId);
        }

        if (!Number.isSafeInteger(record.version) || record.version <= 0) {
            throw new TypeError("Serialized record has an invalid version.");
        }

        if (!Object.hasOwn(record, "data")) {
            throw new TypeError("Serialized record is missing data.");
        }

        if (record.version > registration.Version) {
            throw new Error(
                `Type "${record.typeId}" uses a newer unsupported version.`,
            );
        }

        const serializationContext = SerializationContext.From(context);
        let data = record.data;
        let version = record.version;

        while (version < registration.Version) {
            if (!registration.Migrate) {
                throw new Error(
                    `No migration for "${record.typeId}" from version ${version}.`,
                );
            }

            data = registration.Migrate(data, version, serializationContext);
            if (data === undefined) {
                throw new TypeError(
                    `Migration for "${record.typeId}" returned undefined.`,
                );
            }

            version += 1;
        }

        const value = registration.Deserialize(data, serializationContext);
        if (!(value instanceof registration.runtimeType)) {
            throw new TypeError(
                "Deserializer returned the wrong type for " + record.typeId,
            );
        }

        return value;
    }
}
