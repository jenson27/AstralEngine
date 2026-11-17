import { Parent } from "../components/parent.js";
import { Transform } from "../components/transform.js";

function HasUnitScale(scale) {
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

export class TransformHierarchySystem {
    constructor() {
        this._transformsByEntityId = new Map();
        this._parentByChildId = new Map();
        this._traversalOrder = [];
        this._cachedStructuralRevision = null;
    }

    PrepareRender(scene, { interpolationAlpha }) {
        const entityManager = scene.EntityManager;
        const structuralRevision = entityManager.StructuralRevision;

        if (this._cachedStructuralRevision !== structuralRevision) {
            this._BuildHierarchyGraph(entityManager);
            this._cachedStructuralRevision = structuralRevision;
        }

        this._ValidateActiveCameraScale(scene.ActiveCameraEntityId);
        this._UpdateWorldTransforms(interpolationAlpha);
    }

    _ValidateActiveCameraScale(cameraEntityId) {
        while (cameraEntityId !== null) {
            const transform =
                this._transformsByEntityId.get(cameraEntityId);

            if (!transform) {
                throw new Error(
                    "The active camera hierarchy needs Transform components.",
                );
            }

            if (!HasUnitScale(transform.scale)) {
                throw new RangeError(
                    "The active camera and its parents must have unit scale. " +
                        `Invalid scale on entity "${cameraEntityId}".`,
                );
            }

            cameraEntityId =
                this._parentByChildId.get(cameraEntityId) ?? null;
        }
    }

    _BuildHierarchyGraph(entityManager) {
        this._transformsByEntityId.clear();
        this._parentByChildId.clear();
        this._traversalOrder.length = 0;

        this._CollectTransforms(entityManager);
        this._CollectParentLinks(entityManager);
        this._BuildTraversalOrder();
    }

    _CollectTransforms(entityManager) {
        const transformsByEntityId = this._transformsByEntityId;

        for (const entityId of entityManager.Query(Transform)) {
            transformsByEntityId.set(
                entityId,
                entityManager.GetComponent(entityId, Transform),
            );
        }
    }

    _BuildTraversalOrder() {
        const childrenByParentId = new Map();
        const rootEntityIds = [];

        this._CollectRootsAndChildren(
            childrenByParentId,
            rootEntityIds,
        );
        this._AppendTraversalOrder(
            rootEntityIds,
            childrenByParentId,
        );
        this._ValidateTraversalOrder();
    }

    _CollectRootsAndChildren(childrenByParentId, rootEntityIds) {
        const transformsByEntityId = this._transformsByEntityId;
        const parentByChildId = this._parentByChildId;

        for (const entityId of transformsByEntityId.keys()) {
            const parentEntityId = parentByChildId.get(entityId);

            if (parentEntityId === undefined) {
                rootEntityIds.push(entityId);
                continue;
            }

            let childEntityIds = childrenByParentId.get(parentEntityId);

            if (!childEntityIds) {
                childEntityIds = [];
                childrenByParentId.set(parentEntityId, childEntityIds);
            }

            childEntityIds.push(entityId);
        }
    }

    _AppendTraversalOrder(rootEntityIds, childrenByParentId) {
        const pendingEntityIds = rootEntityIds.slice();

        while (pendingEntityIds.length > 0) {
            const entityId = pendingEntityIds.pop();
            this._traversalOrder.push(entityId);

            const childEntityIds = childrenByParentId.get(entityId);

            if (childEntityIds) {
                for (const childEntityId of childEntityIds) {
                    pendingEntityIds.push(childEntityId);
                }
            }
        }
    }

    _ValidateTraversalOrder() {
        if (
            this._traversalOrder.length !==
            this._transformsByEntityId.size
        ) {
            throw new Error("Parent hierarchy contains a cycle.");
        }
    }

    _UpdateWorldTransforms(interpolationAlpha) {
        const transformsByEntityId = this._transformsByEntityId;
        const parentByChildId = this._parentByChildId;
        for (const entityId of this._traversalOrder) {
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
        }
    }

    _CollectParentLinks(entityManager) {
        const transformsByEntityId = this._transformsByEntityId;
        const parentByChildId = this._parentByChildId;

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
    }
}
