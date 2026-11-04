import { Parent } from "../components/parent.js";
import { Transform } from "../components/transform.js";

const emptyEntityIds = Object.freeze([]);

export class TransformHierarchySystem {
    constructor() {
        this._transformsByEntityId = new Map();
        this._parentByChildId = new Map();
        this._childrenByParentId = new Map();
        this._childListPool = [];
        this._pendingEntityIds = [];
        this._processedEntityIds = new Set();
    }

    PrepareRender(scene, { interpolationAlpha }) {
        this._ResetHierarchyState();
        this._BuildHierarchyGraph(scene.EntityManager);
        this._UpdateWorldTransforms(interpolationAlpha);
    }

    _ResetHierarchyState() {
        const transformsByEntityId = this._transformsByEntityId;
        const parentByChildId = this._parentByChildId;
        const childrenByParentId = this._childrenByParentId;

        transformsByEntityId.clear();
        parentByChildId.clear();
        this._pendingEntityIds.length = 0;
        this._processedEntityIds.clear();

        for (const childEntityIds of childrenByParentId.values()) {
            childEntityIds.length = 0;
            this._childListPool.push(childEntityIds);
        }
        childrenByParentId.clear();
    }

    _BuildHierarchyGraph(entityManager) {
        const transformsByEntityId = this._transformsByEntityId;
        const parentByChildId = this._parentByChildId;
        const childrenByParentId = this._childrenByParentId;
        const pendingEntityIds = this._pendingEntityIds;

        for (const entityId of entityManager.Query(Transform)) {
            transformsByEntityId.set(
                entityId,
                entityManager.GetComponent(entityId, Transform),
            );
        }

        this._CollectParentLinks(
            entityManager,
            transformsByEntityId,
            parentByChildId,
        );

        for (const entityId of transformsByEntityId.keys()) {
            const parentEntityId = parentByChildId.get(entityId);

            if (parentEntityId === undefined) {
                pendingEntityIds.push(entityId);
                continue;
            }

            let childEntityIds = childrenByParentId.get(parentEntityId);

            if (!childEntityIds) {
                childEntityIds = this._childListPool.pop() ?? [];
                childrenByParentId.set(parentEntityId, childEntityIds);
            }

            childEntityIds.push(entityId);
        }
    }

    _UpdateWorldTransforms(interpolationAlpha) {
        const transformsByEntityId = this._transformsByEntityId;
        const parentByChildId = this._parentByChildId;
        const childrenByParentId = this._childrenByParentId;
        const pendingEntityIds = this._pendingEntityIds;
        const processedEntityIds = this._processedEntityIds;

        while (pendingEntityIds.length > 0) {
            const entityId = pendingEntityIds.pop();

            if (processedEntityIds.has(entityId)) {
                continue;
            }

            const transform = transformsByEntityId.get(entityId);
            const parentEntityId = parentByChildId.get(entityId);
            const parentWorldMatrix =
                parentEntityId === undefined
                    ? null
                    : transformsByEntityId.get(parentEntityId).WorldMatrix;

            transform.UpdateWorldMatrix(
                parentWorldMatrix,
                interpolationAlpha,
            );
            processedEntityIds.add(entityId);

            for (const childEntityId of
                childrenByParentId.get(entityId) ?? emptyEntityIds) {
                pendingEntityIds.push(childEntityId);
            }
        }

        if (processedEntityIds.size !== transformsByEntityId.size) {
            throw new Error("Parent hierarchy contains a cycle.");
        }
    }

    _CollectParentLinks(
        entityManager,
        transformsByEntityId,
        parentByChildId,
    ) {
        for (const entityId of entityManager.Query(Parent)) {
            const parent = entityManager.GetComponent(entityId, Parent);

            if (
                !transformsByEntityId.has(entityId) ||
                !transformsByEntityId.has(parent.ParentEntityId)
            ) {
                throw new Error(
                    "Parent hierarchy entities must have Transform components.",
                );
            }

            parentByChildId.set(entityId, parent.ParentEntityId);
        }

        return parentByChildId;
    }
}
