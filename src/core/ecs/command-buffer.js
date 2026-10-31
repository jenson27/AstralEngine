export class CommandBuffer {
    constructor() {
        this._commands = [];
        this._pendingDestroyEntities = new Set();
    }

    AddComponent(entityId, componentType, component) {
        this._RequireNotPendingDestroy(entityId);
        this._commands.push({
            type: "add-component",
            entityId,
            componentType,
            component,
        });
    }

    RemoveComponent(entityId, componentType) {
        this._RequireNotPendingDestroy(entityId);
        this._commands.push({
            type: "remove-component",
            entityId,
            componentType,
        });
    }

    DestroyEntity(entityId) {
        if (this._pendingDestroyEntities.has(entityId)) {
            return false;
        }

        this._pendingDestroyEntities.add(entityId);
        this._commands.push({
            type: "destroy-entity",
            entityId,
        });
        return true;
    }

    Flush(entityManager) {
        const commands = this._commands;
        this._commands = [];
        const errors = [];

        try {
            for (const command of commands) {
                try {
                    switch (command.type) {
                        case "add-component":
                            entityManager.AddComponent(
                                command.entityId,
                                command.componentType,
                                command.component,
                            );
                            break;
                        case "remove-component":
                            entityManager.RemoveComponent(
                                command.entityId,
                                command.componentType,
                            );
                            break;
                        case "destroy-entity":
                            entityManager.DestroyEntity(command.entityId);
                            break;
                        default:
                            throw new Error(
                                `Unknown ECS command: ${command.type}.`,
                            );
                    }
                } catch (error) {
                    const commandError = new Error(
                        `Failed to apply ECS command "${command.type}" ` +
                            `for entity ${command.entityId}.`,
                    );
                    commandError.cause = error;
                    commandError.command = {
                        type: command.type,
                        entityId: command.entityId,
                        componentType: command.componentType?.name ?? null,
                    };
                    errors.push(commandError);
                }
            }
        } finally {
            for (const command of commands) {
                if (command.type === "destroy-entity") {
                    this._pendingDestroyEntities.delete(command.entityId);
                }
            }
        }

        if (errors.length > 0) {
            throw new AggregateError(
                errors,
                `Failed to apply ${errors.length} ECS command(s).`,
            );
        }
    }

    _RequireNotPendingDestroy(entityId) {
        if (this._pendingDestroyEntities.has(entityId)) {
            throw new Error(
                `Entity ${entityId} is already queued for destruction.`,
            );
        }
    }
}
