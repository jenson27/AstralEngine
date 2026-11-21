import { Parent } from "../components/parent.js";
import { Transform } from "../components/transform.js";

export class EditorSceneAuthoringController {
    constructor({
        sceneManager,
        selection,
        history,
        componentCatalog,
        getAssetCatalog = null,
        assetTracker = null,
    }) {
        if (
            !sceneManager ||
            !selection ||
            !history ||
            !componentCatalog ||
            typeof componentCatalog.GetAssetIdsForComponent !== "function" ||
            (getAssetCatalog !== null && typeof getAssetCatalog !== "function") ||
            (assetTracker !== null && typeof assetTracker.Refresh !== "function")
        ) {
            throw new TypeError(
                "Editor scene authoring requires scene, selection, history, and component services.",
            );
        }

        this._sceneManager = sceneManager;
        this._selection = selection;
        this._history = history;
        this._componentCatalog = componentCatalog;
        this._getAssetCatalog = getAssetCatalog;
        this._assetTracker = assetTracker;
        this._pendingOperations = 0;
    }

    get IsBusy() {
        return this._history.IsBusy || this._pendingOperations > 0;
    }

    CreateEntity() {
        const scene = this._sceneManager.ActiveScene;
        this._PrepareEdit(scene);

        const entityManager = scene.EntityManager;
        const entityName = this._CreateEntityName(entityManager);
        const transform = new Transform();
        const entityId = entityManager.CreateEntity(undefined, entityName);
        try {
            entityManager.AddComponent(entityId, Transform, transform);
        } catch (error) {
            entityManager.DestroyEntity(entityId);
            throw error;
        }

        this._history.RecordApplied({
            scene,
            label: "Create entity",
            undo: () => {
                entityManager.DestroyEntity(entityId);
                const currentSelection = this._selection.Current;
                if (
                    currentSelection?.scene === scene &&
                    currentSelection.entityId === entityId
                ) {
                    this._selection.Clear();
                }
            },
            redo: () => {
                entityManager.CreateEntity(entityId, entityName);
                try {
                    entityManager.AddComponent(entityId, Transform, transform);
                } catch (error) {
                    entityManager.DestroyEntity(entityId);
                    throw error;
                }
                this._selection.Select(scene, entityId);
            },
        });
        this._selection.Select(scene, entityId);
        return entityId;
    }

    async AddComponent(scene, entityId, typeId, values = {}) {
        this._PrepareEdit(scene);
        const entityManager = scene.EntityManager;
        entityManager.GetEntityName(entityId);

        const definition = this._componentCatalog.GetById(typeId);
        if (!definition?.create) {
            throw new Error("This component is not available to add.");
        }
        this._RequireComponentCanBeAdded(entityManager, entityId, definition);

        this._pendingOperations += 1;
        try {
            const component = await this._componentCatalog.Create(typeId, {
                scene,
                entityId,
                values,
                acquireAssetHandle: (assetId) =>
                    this._sceneManager.AcquireAssetHandle(assetId),
                getAssetCatalog: this._getAssetCatalog,
            });
            this._RequireCurrentTarget(scene, entityId);
            this._RequireComponentCanBeAdded(
                entityManager,
                entityId,
                definition,
            );

            entityManager.AddComponent(
                entityId,
                definition.componentType,
                component,
            );
            this._history.RecordApplied({
                scene,
                label: `Add ${definition.title}`,
                undo: () => {
                    if (
                        entityManager.GetComponent(
                            entityId,
                            definition.componentType,
                        ) !== component
                    ) {
                        throw new Error(`${definition.title} changed before undo.`);
                    }
                    entityManager.RemoveComponent(
                        entityId,
                        definition.componentType,
                    );
                },
                redo: () =>
                    entityManager.AddComponent(
                        entityId,
                        definition.componentType,
                        component,
                    ),
                retainedAssetIds: this._GetComponentAssetIds(
                    scene,
                    entityId,
                    definition.componentType,
                    component,
                ),
            });
        } finally {
            this._pendingOperations -= 1;
            this._assetTracker?.Refresh();
        }
    }

    DeleteEntity(scene, entityId) {
        this._PrepareEdit(scene);
        const entityManager = scene.EntityManager;
        entityManager.GetEntityName(entityId);
        const snapshots = this._CaptureEntitySubtree(scene, entityId);

        this._RequireNoPendingDestruction(scene, snapshots);
        if (!scene.DestroyEntity(entityId)) {
            throw new Error("This entity hierarchy is already being deleted.");
        }

        const subtreeEntityIds = new Set(
            snapshots.map((snapshot) => snapshot.entityId),
        );
        this._history.RecordApplied({
            scene,
            label: `Delete ${snapshots[0].name}`,
            undo: () => {
                this._RequireNoPendingDestruction(scene, snapshots);
                this._RestoreEntitySubtree(scene, snapshots);
                this._selection.Select(scene, entityId);
            },
            redo: () => {
                this._RequireNoPendingDestruction(scene, snapshots);
                if (!scene.DestroyEntity(entityId)) {
                    throw new Error(
                        "This entity hierarchy is already being deleted.",
                    );
                }
                this._ClearSubtreeSelection(scene, subtreeEntityIds);
            },
            retainedAssetIds: snapshots.flatMap((snapshot) =>
                snapshot.components.flatMap(({ componentType, component }) =>
                    this._GetComponentAssetIds(
                        scene,
                        snapshot.entityId,
                        componentType,
                        component,
                    ),
                ),
            ),
        });
        this._ClearSubtreeSelection(scene, subtreeEntityIds);
    }

    _RequireComponentCanBeAdded(entityManager, entityId, definition) {
        if (entityManager.HasComponent(entityId, definition.componentType)) {
            throw new Error(`${definition.title} is already on this entity.`);
        }
        if (
            !definition.requiredComponentTypes.every((requiredType) =>
                entityManager.HasComponent(entityId, requiredType),
            )
        ) {
            throw new Error(`${definition.title} requires additional components.`);
        }
    }

    _CaptureEntitySubtree(scene, rootEntityId) {
        const entityManager = scene.EntityManager;
        const childrenByParentId = new Map();
        for (const entityId of entityManager.GetEntityIds()) {
            const parentEntityId = entityManager.GetComponent(
                entityId,
                Parent,
            )?.ParentEntityId;
            if (!parentEntityId) {
                continue;
            }

            const children = childrenByParentId.get(parentEntityId) ?? [];
            children.push(entityId);
            childrenByParentId.set(parentEntityId, children);
        }

        const entityIds = [];
        const visitedEntityIds = new Set();
        const stack = [rootEntityId];
        while (stack.length > 0) {
            const entityId = stack.pop();
            if (visitedEntityIds.has(entityId)) {
                continue;
            }

            visitedEntityIds.add(entityId);
            entityIds.push(entityId);
            const children = childrenByParentId.get(entityId) ?? [];
            for (let index = children.length - 1; index >= 0; index -= 1) {
                stack.push(children[index]);
            }
        }

        return entityIds.map((entityId) => ({
            entityId,
            name: entityManager.GetEntityName(entityId),
            isActive: entityManager.IsEntityActive(entityId),
            parentEntityId:
                entityManager.GetComponent(entityId, Parent)?.ParentEntityId ??
                null,
            components: entityManager
                .GetComponentEntries(entityId)
                .map(({ componentType, component }) => ({
                    componentType,
                    component,
                    isEnabled: entityManager.IsComponentEnabled(
                        entityId,
                        componentType,
                    ),
                })),
        }));
    }

    _RestoreEntitySubtree(scene, snapshots) {
        const entityManager = scene.EntityManager;
        const createdEntityIds = [];
        try {
            for (const snapshot of snapshots) {
                entityManager.CreateEntity(snapshot.entityId, snapshot.name);
                createdEntityIds.push(snapshot.entityId);
                for (const componentSnapshot of snapshot.components) {
                    if (componentSnapshot.componentType === Parent) {
                        continue;
                    }
                    entityManager.AddComponent(
                        snapshot.entityId,
                        componentSnapshot.componentType,
                        componentSnapshot.component,
                    );
                }
            }

            for (const snapshot of snapshots) {
                if (snapshot.parentEntityId !== null) {
                    scene.SetParent(snapshot.entityId, snapshot.parentEntityId);
                }
            }
            for (const snapshot of snapshots) {
                if (!snapshot.isActive) {
                    scene.SetEntityActive(snapshot.entityId, false);
                }
                for (const componentSnapshot of snapshot.components) {
                    if (!componentSnapshot.isEnabled) {
                        scene.SetComponentEnabled(
                            snapshot.entityId,
                            componentSnapshot.componentType,
                            false,
                        );
                    }
                }
            }
        } catch (error) {
            for (const snapshot of snapshots) {
                if (snapshot.parentEntityId !== null) {
                    try {
                        scene.SetParent(snapshot.entityId, null);
                    } catch {
                        // Continue cleanup after a failed restore.
                    }
                }
            }
            for (const createdEntityId of createdEntityIds.reverse()) {
                try {
                    entityManager.DestroyEntity(createdEntityId);
                } catch {
                    // Continue cleanup after a failed restore.
                }
            }
            throw error;
        }
    }

    _RequireNoPendingDestruction(scene, snapshots) {
        if (
            snapshots.some((snapshot) =>
                scene.CommandBuffer.IsEntityPendingDestroy(snapshot.entityId),
            )
        ) {
            throw new Error(
                "Wait for the scene update to finish before changing this hierarchy.",
            );
        }
    }

    _ClearSubtreeSelection(scene, subtreeEntityIds) {
        const selection = this._selection.Current;
        if (
            selection?.scene === scene &&
            subtreeEntityIds.has(selection.entityId)
        ) {
            this._selection.Clear();
        }
    }

    _RequireCurrentTarget(scene, entityId) {
        const selection = this._selection.Current;
        if (
            scene !== this._sceneManager.ActiveScene ||
            selection?.scene !== scene ||
            selection.entityId !== entityId
        ) {
            throw new Error("Scene or selection changed before the edit completed.");
        }
    }

    RemoveComponent(scene, entityId, typeId) {
        this._PrepareEdit(scene);
        const entityManager = scene.EntityManager;
        entityManager.GetEntityName(entityId);

        const definition = this._componentCatalog.GetById(typeId);
        if (!definition) {
            throw new Error("This component is not available to remove.");
        }
        const component = entityManager.GetComponent(
            entityId,
            definition.componentType,
        );
        if (!component) {
            throw new Error(`${definition.title} is no longer on this entity.`);
        }
        if (
            !this._componentCatalog.CanRemove(definition.componentType, {
                scene,
                entityId,
                component,
                entityManager,
            })
        ) {
            throw new Error(`${definition.title} cannot be removed from this entity.`);
        }

        const wasEnabled = entityManager.IsComponentEnabled(
            entityId,
            definition.componentType,
        );
        entityManager.RemoveComponent(entityId, definition.componentType);
        this._history.RecordApplied({
            scene,
            label: `Remove ${definition.title}`,
            undo: () => {
                entityManager.AddComponent(
                    entityId,
                    definition.componentType,
                    component,
                );
                if (!wasEnabled) {
                    entityManager.SetComponentEnabled(
                        entityId,
                        definition.componentType,
                        false,
                    );
                }
            },
            redo: () =>
                entityManager.RemoveComponent(entityId, definition.componentType),
            retainedAssetIds: this._GetComponentAssetIds(
                scene,
                entityId,
                definition.componentType,
                component,
            ),
        });
    }

    _PrepareEdit(scene) {
        if (!scene || scene !== this._sceneManager.ActiveScene) {
            throw new Error("Scene authoring requires the active scene.");
        }
        if (this.IsBusy) {
            throw new Error("Wait for the current editor action to finish.");
        }
        this._history.SetScene(scene);
    }

    _GetComponentAssetIds(scene, entityId, componentType, component) {
        return this._componentCatalog.GetAssetIdsForComponent(
            componentType,
            component,
            { scene, entityId },
        );
    }

    _CreateEntityName(entityManager) {
        const names = new Set(
            entityManager
                .GetEntityIds()
                .map((entityId) => entityManager.GetEntityName(entityId)),
        );
        if (!names.has("Entity")) {
            return "Entity";
        }

        let suffix = 2;
        while (names.has(`Entity ${suffix}`)) {
            suffix += 1;
        }
        return `Entity ${suffix}`;
    }
}
