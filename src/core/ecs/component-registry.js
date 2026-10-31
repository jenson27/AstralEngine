import { SerializationContext } from "../../serialization/serialization-context.js";
import { TypeSerializerRegistry } from "../../serialization/type-serializer-registry.js";

export class ComponentRegistry {
    constructor(serializerRegistry = new TypeSerializerRegistry()) {
        if (
            !serializerRegistry ||
            typeof serializerRegistry.Register !== "function" ||
            typeof serializerRegistry.Serialize !== "function" ||
            typeof serializerRegistry.Deserialize !== "function" ||
            typeof serializerRegistry.GetRuntimeType !== "function"
        ) {
            throw new TypeError(
                "ComponentRegistry requires a type serializer registry.",
            );
        }

        this._serializerRegistry = serializerRegistry;
        this._componentVersionsById = new Map();
    }

    get Serializers() {
        return this._serializerRegistry;
    }

    Register(
        typeId,
        componentType,
        factory,
        { Version = 1, Serialize, Migrate } = {},
    ) {
        if (typeof typeId !== "string" || typeId.trim() === "") {
            throw new TypeError("Component type ID must be a non-empty string.");
        }

        if (
            typeof componentType !== "function" ||
            !componentType.prototype
        ) {
            throw new TypeError("Component type must be a class.");
        }

        if (typeof factory !== "function") {
            throw new TypeError("Component factory must be a function.");
        }

        if (this._componentVersionsById.has(typeId)) {
            throw new Error("Component type ID is already registered: " + typeId);
        }

        this._serializerRegistry.Register(typeId, componentType, {
            Version,
            Serialize,
            Deserialize: factory,
            Migrate,
        });
        this._componentVersionsById.set(typeId, Version);
    }

    CreateComponent(typeId, data, services = {}) {
        const version = this._componentVersionsById.get(typeId);

        if (version === undefined) {
            throw new Error("Unknown component type ID: " + typeId);
        }

        return this.DeserializeComponent(
            { typeId, version, data },
            services,
        );
    }

    DeserializeComponent(record, context = {}) {
        if (!this._componentVersionsById.has(record?.typeId)) {
            throw new Error("Unknown component type ID: " + record?.typeId);
        }

        const component = this._serializerRegistry.Deserialize(
            record,
            SerializationContext.From(context),
        );

        return {
            componentType: this._serializerRegistry.GetRuntimeType(record.typeId),
            component,
        };
    }

    SerializeComponent(component, context = {}) {
        const record = this._serializerRegistry.Serialize(
            component,
            SerializationContext.From(context),
        );

        if (!this._componentVersionsById.has(record.typeId)) {
            throw new Error("Type is registered but is not a component.");
        }

        return record;
    }
}
