import { CommandBuffer } from "./ecs/command-buffer.js";
import { EntityManager } from "./ecs/entity-manager.js";
import { IsEntityId } from "./ecs/entity-id.js";
import { SystemPhase, SystemScheduler } from "./system-scheduler.js";
import { Camera } from "../components/graphics/camera.js";
import { Parent } from "../components/parent.js";
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
        this._pendingParentChanges = new Map();
        this._isApplyingParentChanges = false;
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

    /**
     * Queues a parent change while preserving the child's local transform.
     * The child's world transform changes to reflect the new parent.
     */
    SetParent(childEntityId, parentEntityId = null) {
        this._RequireActive();
        this._RequireTransformEntity(childEntityId);

        if (parentEntityId !== null) {
            if (!IsEntityId(parentEntityId)) {
                throw new TypeError(
                    "Parent entity ID must be a lowercase UUID or null.",
                );
            }
            this._RequireTransformEntity(parentEntityId);
        }

        if (
            this._commandBuffer.IsEntityPendingDestroy(childEntityId) ||
            (parentEntityId !== null &&
                this._commandBuffer.IsEntityPendingDestroy(parentEntityId))
        ) {
            throw new Error(
                "Cannot change a parent relationship for an entity queued for destruction.",
            );
        }

        const currentParentEntityId =
            this._GetParentByChildId().get(childEntityId) ?? null;
        if (currentParentEntityId === parentEntityId) {
            return false;
        }

        const parentChanges = new Map(this._pendingParentChanges);
        parentChanges.set(childEntityId, parentEntityId);
        this._ValidateParentChanges(parentChanges);
        this._ValidateActiveCameraScale(parentChanges);
        this._pendingParentChanges = parentChanges;
        return true;
    }

    DestroyEntity(entityId) {
        this._RequireActive();
        this._entityManager.GetEntityName(entityId);

        const entityIds = this._GetEntitySubtreePostOrder(entityId);
        if (entityIds.includes(this._activeCameraEntityId)) {
            throw new Error(
                "Switch to another camera before destroying its hierarchy.",
            );
        }

        let rootQueued = false;
        for (const childOrRootId of entityIds) {
            const queued = this._commandBuffer.DestroyEntity(childOrRootId);
            if (childOrRootId === entityId) {
                rootQueued = queued;
            }
        }

        return rootQueued;
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
            this._ApplyPendingParentChanges();
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
        this._pendingParentChanges.clear();
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

    _RequireTransformEntity(entityId) {
        this._entityManager.GetEntityName(entityId);
        if (!this._entityManager.HasComponent(entityId, Transform)) {
            throw new Error(
                `Entity "${entityId}" must have a Transform component.`,
            );
        }
    }

    _GetParentByChildId(parentChanges = this._pendingParentChanges) {
        const parentByChildId = new Map();

        for (const childEntityId of this._entityManager.Query(Parent)) {
            parentByChildId.set(
                childEntityId,
                this._entityManager
                    .GetComponent(childEntityId, Parent)
                    .ParentEntityId,
            );
        }

        for (const [childEntityId, parentEntityId] of parentChanges) {
            if (parentEntityId === null) {
                parentByChildId.delete(childEntityId);
            } else {
                parentByChildId.set(childEntityId, parentEntityId);
            }
        }

        return parentByChildId;
    }

    _ValidateParentChanges(parentChanges) {
        const parentByChildId = this._GetParentByChildId(parentChanges);

        for (const [childEntityId, parentEntityId] of parentByChildId) {
            this._RequireTransformEntity(childEntityId);
            this._RequireTransformEntity(parentEntityId);
        }

        this._ValidateParentHierarchyAcyclic(parentByChildId);
    }

    _ValidateActiveCameraScale(parentChanges) {
        if (this._activeCameraEntityId === null) {
            return;
        }

        const parentByChildId = this._GetParentByChildId(parentChanges);
        const visitedEntityIds = new Set();
        let entityId = this._activeCameraEntityId;

        while (entityId !== undefined) {
            if (visitedEntityIds.has(entityId)) {
                throw new Error("Parent hierarchy contains a cycle.");
            }

            visitedEntityIds.add(entityId);

            const scale = this._entityManager
                .GetComponent(entityId, Transform)
                .scale;

            if (!this._HasUnitScale(scale)) {
                throw new RangeError(
                    "The active camera and its parents must have unit scale.",
                );
            }

            entityId = parentByChildId.get(entityId);
        }
    }

    _HasUnitScale(scale) {
        return (
            scale?.length === 3 &&
            Number.isFinite(scale[0]) &&
            Number.isFinite(scale[1]) &&
            Number.isFinite(scale[2]) &&
            Math.abs(scale[0] - 1) <= 1e-6 &&
            Math.abs(scale[1] - 1) <= 1e-6 &&
            Math.abs(scale[2] - 1) <= 1e-6
        );
    }

    _ValidateParentHierarchyAcyclic(parentByChildId) {
        const visited = new Set();

        for (const startEntityId of parentByChildId.keys()) {
            const path = new Set();
            let entityId = startEntityId;

            while (parentByChildId.has(entityId)) {
                if (path.has(entityId)) {
                    throw new Error("Parent hierarchy contains a cycle.");
                }
                if (visited.has(entityId)) {
                    break;
                }

                path.add(entityId);
                entityId = parentByChildId.get(entityId);
            }

            for (const pathEntityId of path) {
                visited.add(pathEntityId);
            }
        }
    }

    _ApplyPendingParentChanges() {
        if (this._pendingParentChanges.size === 0) {
            return;
        }

        const parentChanges = this._pendingParentChanges;
        this._pendingParentChanges = new Map();
        this._ValidateParentChanges(parentChanges);

        this._isApplyingParentChanges = true;
        try {
            for (const [childEntityId, parentEntityId] of parentChanges) {
                this._ApplyParentChange(childEntityId, parentEntityId);
            }
        } finally {
            this._isApplyingParentChanges = false;
        }
    }

    _ApplyParentChange(childEntityId, parentEntityId) {
        const currentParent = this._entityManager.GetComponent(
            childEntityId,
            Parent,
        );

        if (parentEntityId === null) {
            if (currentParent) {
                this._entityManager.RemoveComponent(childEntityId, Parent);
            }
            return;
        }

        if (currentParent?.ParentEntityId === parentEntityId) {
            return;
        }

        if (currentParent) {
            this._entityManager.RemoveComponent(childEntityId, Parent);
        }

        this._entityManager.AddComponent(
            childEntityId,
            Parent,
            new Parent(parentEntityId),
        );
    }

    _GetEntitySubtreePostOrder(rootEntityId) {
        const parentByChildId = this._GetParentByChildId();
        const childrenByParentId =
            this._BuildChildrenByParentId(parentByChildId);

        return this._CollectSubtreePostOrder(
            rootEntityId,
            childrenByParentId,
        );
    }

    _BuildChildrenByParentId(parentByChildId) {
        const childrenByParentId = new Map();

        for (const [childEntityId, parentEntityId] of parentByChildId) {
            const childEntityIds =
                childrenByParentId.get(parentEntityId) ?? [];
            childEntityIds.push(childEntityId);
            childrenByParentId.set(parentEntityId, childEntityIds);
        }

        return childrenByParentId;
    }

    _CollectSubtreePostOrder(rootEntityId, childrenByParentId) {
        const postOrderEntityIds = [];
        const stateByEntityId = new Map();
        const stack = [{ entityId: rootEntityId, expanded: false }];

        while (stack.length > 0) {
            const { entityId, expanded } = stack.pop();

            if (expanded) {
                stateByEntityId.set(entityId, "visited");
                postOrderEntityIds.push(entityId);
                continue;
            }

            const state = stateByEntityId.get(entityId);

            if (state === "visited") {
                continue;
            }

            if (state === "visiting") {
                throw new Error("Parent hierarchy contains a cycle.");
            }

            stateByEntityId.set(entityId, "visiting");
            stack.push({ entityId, expanded: true });

            const childEntityIds =
                childrenByParentId.get(entityId) ?? [];

            for (
                let index = childEntityIds.length - 1;
                index >= 0;
                index -= 1
            ) {
                stack.push({
                    entityId: childEntityIds[index],
                    expanded: false,
                });
            }
        }

        return postOrderEntityIds;
    }

    _HasParentRelationship(entityId) {
        if (this._entityManager.HasComponent(entityId, Parent)) {
            return true;
        }

        for (const childEntityId of this._entityManager.Query(Parent)) {
            if (
                this._entityManager
                    .GetComponent(childEntityId, Parent)
                    .ParentEntityId === entityId
            ) {
                return true;
            }
        }

        for (const [childEntityId, parentEntityId] of
            this._pendingParentChanges) {
            if (
                (childEntityId === entityId && parentEntityId !== null) ||
                parentEntityId === entityId
            ) {
                return true;
            }
        }

        return false;
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

        this._ValidateRuntimeParentMutation(type, componentType);

        if (type === "create-entity" || type === "add-component") {
            return;
        }

        if (type === "destroy-all-entities") {
            this._ValidateDestroyAllEntities();
            return;
        }

        this._ValidateDirectEntityDestruction(type, entityId);
        this._ValidateActiveCameraMutation(type, entityId, componentType);
        this._ValidateParentTransformRemoval(type, entityId, componentType);
    }

    _ValidateRuntimeParentMutation(type, componentType) {
        if (
            this._state === "active" &&
            !this._isApplyingParentChanges &&
            componentType === Parent &&
            (type === "add-component" || type === "remove-component")
        ) {
            throw new Error(
                "Use Scene.SetParent() to change a parent relationship at runtime.",
            );
        }
    }

    _ValidateDestroyAllEntities() {
        if (this._activeCameraEntityId !== null) {
            throw new Error(
                "Cannot destroy all entities while the scene has an active camera.",
            );
        }

        if ([...this._entityManager.Query(Parent)].length > 0) {
            throw new Error(
                "Cannot destroy all entities while parent relationships exist. " +
                    "Use Scene.DestroyEntity() to preserve hierarchy order.",
            );
        }
    }

    _ValidateDirectEntityDestruction(type, entityId) {
        if (
            type === "destroy-entity" &&
            [...this._entityManager.Query(Parent)].some(
                (childEntityId) =>
                    this._entityManager
                        .GetComponent(childEntityId, Parent)
                        .ParentEntityId === entityId,
            )
        ) {
            throw new Error(
                "Cannot destroy an entity that has children. " +
                    "Use Scene.DestroyEntity() to destroy its hierarchy.",
            );
        }
    }

    _ValidateActiveCameraMutation(type, entityId, componentType) {
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

    _ValidateParentTransformRemoval(type, entityId, componentType) {
        if (
            type === "remove-component" &&
            componentType === Transform &&
            this._HasParentRelationship(entityId)
        ) {
            throw new Error(
                "Cannot remove Transform while the entity has a parent or children. " +
                    "Detach or reparent it first.",
            );
        }
    }
}
