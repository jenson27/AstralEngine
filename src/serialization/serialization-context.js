export class SerializationContext {
    constructor(services = {}) {
        if (
            !services ||
            typeof services !== "object" ||
            Array.isArray(services)
        ) {
            throw new TypeError("Serialization services must be an object.");
        }

        this._services = new Map(Object.entries(services));
    }

    static From(value = {}) {
        if (value instanceof SerializationContext) {
            return value;
        }

        return new SerializationContext(value);
    }

    GetService(serviceId) {
        return this._services.get(serviceId);
    }

    RequireService(serviceId) {
        const service = this.GetService(serviceId);
        if (service === undefined || service === null) {
            throw new Error("Missing serialization service: " + serviceId);
        }

        return service;
    }
}
