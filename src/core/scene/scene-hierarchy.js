import { Parent } from "../../components/parent.js";
import { Transform } from "../../components/transform.js";

export class SceneHierarchy {
    constructor(entityManager) {
        this._entityManager = entityManager;
        this._pendingParentChanges = new Map();
        this._isApplyingChanges = false;
    }

    get HasPendingChanges() {
        return this._pendingParentChanges.size > 0;
    }

    get IsApplyingChanges() {
        return this._isApplyingChanges;
    }

    RequireTransformEntity(entityId) {
        this._entityManager.GetEntityName(entityId);
        if (!this._entityManager.HasComponent(entityId, Transform)) {
            throw new Error(
                `Entity "${entityId}" must have a Transform component.`,
            );
        }
    }

    IsEntityActiveInHierarchy(entityId) {
        this._entityManager.GetEntityName(entityId);
        const visitedEntityIds = new Set();
        let currentEntityId = entityId;

        while (currentEntityId !== null) {
            if (visitedEntityIds.has(currentEntityId)) {
                throw new Error("Parent hierarchy contains a cycle.");
            }
            visitedEntityIds.add(currentEntityId);

            if (!this._entityManager.IsEntityActive(currentEntityId)) {
                return false;
            }

            const parent = this._entityManager.GetComponent(
                currentEntityId,
                Parent,
            );
            currentEntityId = parent?.ParentEntityId ?? null;
        }

        return true;
    }

    GetParentByChildId(parentChanges = this._pendingParentChanges) {
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

    QueueParentChange(childEntityId, parentEntityId, validateSceneRules) {
        const currentParentEntityId =
            this.GetParentByChildId().get(childEntityId) ?? null;
        if (currentParentEntityId === parentEntityId) {
            return false;
        }

        const parentChanges = new Map(this._pendingParentChanges);
        parentChanges.set(childEntityId, parentEntityId);
        const parentByChildId = this.ValidateParentChanges(parentChanges);
        validateSceneRules(parentByChildId);
        this._pendingParentChanges = parentChanges;
        return true;
    }

    ValidateParentChanges(parentChanges) {
        const parentByChildId = this.GetParentByChildId(parentChanges);

        for (const [childEntityId, parentEntityId] of parentByChildId) {
            this.RequireTransformEntity(childEntityId);
            this.RequireTransformEntity(parentEntityId);
        }

        this._ValidateParentHierarchyAcyclic(parentByChildId);
        return parentByChildId;
    }

    ForEachAncestor(startEntityId, visit, parentByChildId = null) {
        const visitedEntityIds = new Set();
        let entityId = startEntityId;

        while (entityId !== null && entityId !== undefined) {
            if (visitedEntityIds.has(entityId)) {
                throw new Error("Parent hierarchy contains a cycle.");
            }
            visitedEntityIds.add(entityId);

            if (visit(entityId) === false) {
                return false;
            }

            if (parentByChildId) {
                entityId = parentByChildId.get(entityId);
            } else {
                const parent = this._entityManager.GetComponent(
                    entityId,
                    Parent,
                );
                entityId = parent?.ParentEntityId ?? null;
            }
        }

        return true;
    }

    ApplyPendingChanges() {
        if (!this.HasPendingChanges) {
            return;
        }

        const parentChanges = this._pendingParentChanges;
        this._pendingParentChanges = new Map();
        this.ValidateParentChanges(parentChanges);

        this._isApplyingChanges = true;
        try {
            for (const [childEntityId, parentEntityId] of parentChanges) {
                this._ApplyParentChange(childEntityId, parentEntityId);
            }
        } finally {
            this._isApplyingChanges = false;
        }
    }

    GetSubtreePostOrder(rootEntityId) {
        const parentByChildId = this.GetParentByChildId();
        const childrenByParentId = new Map();

        for (const [childEntityId, parentEntityId] of parentByChildId) {
            const childEntityIds =
                childrenByParentId.get(parentEntityId) ?? [];
            childEntityIds.push(childEntityId);
            childrenByParentId.set(parentEntityId, childEntityIds);
        }

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

    HasParentRelationship(entityId) {
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

    ClearPendingChanges() {
        this._pendingParentChanges.clear();
    }

    _ValidateParentHierarchyAcyclic(parentByChildId) {
        const visited = new Set();

        for (const startEntityId of parentByChildId.keys()) {
            this._ValidateParentChain(
                startEntityId,
                parentByChildId,
                visited,
            );
        }
    }

    _ValidateParentChain(startEntityId, parentByChildId, visited) {
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
}
