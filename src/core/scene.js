import { CommandBuffer } from "./ecs/command-buffer.js";
import { EntityManager } from "./ecs/entity-manager.js";
import { IsEntityId } from "./ecs/entity-id.js";
import { SystemPhase, SystemScheduler } from "./system-scheduler.js";
import { Camera } from "../components/graphics/camera.js";
import { Transform } from "../components/transform.js";

export class Scene {
    constructor(name) {
        if (typeof name !== "string" || name.trim() === "") {
            throw new TypeError("Scene name must be a non-empty string.");
        }

        this._name = name;
        this._activeCameraEntityId = null;
        this._state = "created";
        this._entityManager = new EntityManager((change) =>
            this._ValidateStructuralChange(change),
        );
        this._commandBuffer = new CommandBuffer();
        this._systemScheduler = new SystemScheduler();
        this._initializedSystems = [];
    }

    get Name() {
        return this._name;
    }

    get EntityManager() {
        return this._entityManager;
    }

    get CommandBuffer() {
        return this._commandBuffer;
    }

    get ActiveCameraEntityId() {
        return this._activeCameraEntityId;
    }

    AddSystem(phase, system) {
        if (this._state !== "created") {
            throw new Error("Systems must be registered before initialization.");
        }

        this._systemScheduler.AddSystem(phase, system);
    }

    SetActiveCameraEntity(entityId) {
        if (!IsEntityId(entityId)) {
            throw new TypeError(
                "Active camera entity ID must be a lowercase UUID.",
            );
        }

        if (this._state === "disposing" || this._state === "disposed") {
            throw new Error("Cannot set the camera of a disposed scene.");
        }

        this._RequireCameraEntity(entityId);
        this._activeCameraEntityId = entityId;
    }

    Initialize(services = {}) {
        if (this._state !== "created") {
            throw new Error("Scene can only be initialized once.");
        }

        this._state = "initializing";

        try {
            for (const system of this._systemScheduler.GetSystems()) {
                this._initializedSystems.push(system);
                system.Initialize?.(this, services);
            }

            this._state = "active";
        } catch (error) {
            this._state = "failed";
            throw error;
        }
    }

    FixedUpdate(deltaTime, elapsedTime) {
        this._RequireActive();
        const errors = [];
        try {
            this._systemScheduler.Run(SystemPhase.FixedUpdate, this, {
                deltaTime,
                elapsedTime,
            });
        } catch (error) {
            errors.push(error);
        }

        try {
            this._commandBuffer.Flush(this._entityManager);
        } catch (error) {
            errors.push(error);
        }

        try {
            this._entityManager.DispatchComponentRemovals();
        } catch (error) {
            errors.push(error);
        }

        if (errors.length > 0) {
            throw new AggregateError(
                errors,
                "Scene fixed update failed: " + this._name,
            );
        }
    }

    PrepareRender(interpolationAlpha, aspectRatio) {
        this._RequireActive();
        this._systemScheduler.Run(SystemPhase.PrepareRender, this, {
            interpolationAlpha,
            aspectRatio,
        });
    }

    Dispose() {
        if (this._state === "initializing") {
            throw new Error("Cannot dispose a scene during initialization.");
        }

        if (this._state === "disposing" || this._state === "disposed") {
            return;
        }

        this._state = "disposing";
        this._commandBuffer.Dispose();
        const errors = [];

        try {
            this._entityManager.DestroyAllEntities();
        } catch (error) {
            errors.push(error);
        }

        try {
            this._entityManager.DispatchComponentRemovals();
        } catch (error) {
            errors.push(error);
        }

        for (const system of [...this._initializedSystems].reverse()) {
            try {
                system.Shutdown?.(this);
            } catch (error) {
                errors.push(error);
            }
        }

        this._initializedSystems.length = 0;
        this._activeCameraEntityId = null;
        this._state = "disposed";

        if (errors.length > 0) {
            throw new AggregateError(errors, "Scene disposal failed: " + this._name);
        }
    }

    _RequireActive() {
        if (this._state !== "active") {
            throw new Error("Scene is not active: " + this._name);
        }
    }

    _RequireCameraEntity(entityId) {
        if (
            !this._entityManager.HasComponent(entityId, Camera) ||
            !this._entityManager.HasComponent(entityId, Transform)
        ) {
            throw new Error(
                "Active camera entity must have Camera and Transform components.",
            );
        }
    }

    _ValidateStructuralChange({ type, entityId, componentType }) {
        if (this._state === "disposed") {
            throw new Error("Cannot change a disposed scene.");
        }

        if (this._state === "disposing") {
            if (type === "destroy-all-entities" || type === "destroy-entity") {
                return;
            }

            throw new Error("Cannot change a scene while it is being disposed.");
        }

        if (type === "create-entity" || type === "add-component") {
            return;
        }

        if (type === "destroy-all-entities") {
            if (this._activeCameraEntityId !== null) {
                throw new Error(
                    "Cannot destroy all entities while the scene has an active camera.",
                );
            }
            return;
        }

        if (entityId !== this._activeCameraEntityId) {
            return;
        }

        const removesActiveCamera =
            type === "destroy-entity" ||
            (type === "remove-component" &&
                (componentType === Camera || componentType === Transform));

        if (removesActiveCamera) {
            throw new Error(
                "Switch to another camera before removing the active camera, its Camera component, or its Transform component.",
            );
        }
    }
}
