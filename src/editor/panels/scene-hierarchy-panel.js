import { Parent } from "../../components/parent.js";
import { CreateElement } from "../ui/dom-utils.js";

export class SceneHierarchyPanel {
    constructor(sceneManager, rootElement) {
        if (
            !sceneManager ||
            typeof sceneManager.LoadScene !== "function" ||
            typeof sceneManager.FixedUpdate !== "function"
        ) {
            throw new TypeError(
                "SceneHierarchyPanel requires a scene manager.",
            );
        }

        if (!(rootElement instanceof HTMLElement)) {
            throw new TypeError(
                "SceneHierarchyPanel requires a content element.",
            );
        }

        this._sceneManager = sceneManager;
        this._root = rootElement;
        this._root.classList.add("hierarchy-panel");
        this._selectedEntityId = null;
        this._refreshTimer = null;
        this._lastScene = undefined;
        this._lastStructureRevision = null;
        this._lastEntityNameRevision = null;
        this._lastActiveCameraEntityId = undefined;
        this._lastSceneName = undefined;
        this._lastSelection = undefined;
        this._root.innerHTML = `
            <div class="hierarchy-scene-label">
                <span data-role="scene-name"></span>
            </div>
            <div class="hierarchy-entity-list" data-role="entities" role="list" aria-label="Scene entities"></div>
            <div class="hierarchy-empty" data-role="empty" hidden></div>`;

        this._onClick = this._HandleClick.bind(this);
        this._root.addEventListener("click", this._onClick);
        this._Refresh();
        this._UpdateRefreshTimer();
    }

    Dispose() {
        if (this._refreshTimer !== null) {
            globalThis.clearInterval(this._refreshTimer);
            this._refreshTimer = null;
        }

        this._root.removeEventListener("click", this._onClick);
    }

    _CanPoll() {
        return this._root.closest("[hidden]") === null;
    }

    _UpdateRefreshTimer() {
        if (this._CanPoll() && this._refreshTimer === null) {
            this._refreshTimer = globalThis.setInterval(
                () => this._Refresh(),
                500,
            );
        } else if (!this._CanPoll() && this._refreshTimer !== null) {
            globalThis.clearInterval(this._refreshTimer);
            this._refreshTimer = null;
        }
    }

    _HandleClick(event) {
        const entityButton = event.target.closest("[data-entity-id]");

        if (!entityButton || !this._root.contains(entityButton)) {
            return;
        }

        this._selectedEntityId = entityButton.dataset.entityId;
        this._Refresh();
    }

    _BuildHierarchy(entityManager, entityIds) {
        const entityIdSet = new Set(entityIds);
        const childrenByParentId = new Map();
        const rootEntityIds = [];

        for (const entityId of entityIds) {
            const parentEntityId = entityManager.GetComponent(
                entityId,
                Parent,
            )?.ParentEntityId;

            if (!entityIdSet.has(parentEntityId)) {
                rootEntityIds.push(entityId);
                continue;
            }

            const children = childrenByParentId.get(parentEntityId) ?? [];
            children.push(entityId);
            childrenByParentId.set(parentEntityId, children);
        }

        return { entityIdSet, childrenByParentId, rootEntityIds };
    }

    _KeepSelectionValid(entityIdSet, activeCameraEntityId) {
        if (
            this._selectedEntityId === null ||
            !entityIdSet.has(this._selectedEntityId)
        ) {
            this._selectedEntityId = entityIdSet.has(activeCameraEntityId)
                ? activeCameraEntityId
                : null;
        }
    }

    _CreateEntityItem(entityManager, entityId, depth) {
        const item = CreateElement("div", "hierarchy-entity-item");
        item.setAttribute("role", "listitem");

        const button = CreateElement("button", "hierarchy-entity");
        button.type = "button";
        button.dataset.entityId = entityId;
        button.style.paddingInlineStart = `${0.55 + depth * 1.1}rem`;
        button.setAttribute(
            "aria-pressed",
            String(entityId === this._selectedEntityId),
        );
        button.textContent = entityManager.GetEntityName(entityId);
        item.append(button);

        return item;
    }

    _RenderEntityTree(
        entityManager,
        entityIds,
        rootEntityIds,
        childrenByParentId,
    ) {
        const fragment = document.createDocumentFragment();
        const visitedEntityIds = new Set();
        const traversalRoots = [...rootEntityIds, ...entityIds];

        for (const rootEntityId of traversalRoots) {
            if (visitedEntityIds.has(rootEntityId)) {
                continue;
            }

            const stack = [{ entityId: rootEntityId, depth: 0 }];

            while (stack.length > 0) {
                const { entityId, depth } = stack.pop();

                if (visitedEntityIds.has(entityId)) {
                    continue;
                }

                visitedEntityIds.add(entityId);
                fragment.append(
                    this._CreateEntityItem(entityManager, entityId, depth),
                );

                const children = childrenByParentId.get(entityId) ?? [];
                for (let index = children.length - 1; index >= 0; index -= 1) {
                    stack.push({
                        entityId: children[index],
                        depth: depth + 1,
                    });
                }
            }
        }

        return fragment;
    }

    _ClearSceneView(sceneName, entityList, empty) {
        sceneName.textContent = "No active scene";
        entityList.replaceChildren();
        empty.textContent = "No scene is loaded.";
        empty.hidden = false;
        this._selectedEntityId = null;
        this._lastScene = null;
        this._lastStructureRevision = null;
        this._lastEntityNameRevision = null;
        this._lastActiveCameraEntityId = undefined;
        this._lastSceneName = undefined;
        this._lastSelection = null;
    }

    _IsSceneUnchanged(scene, entityManager) {
        return (
            this._lastScene === scene &&
            this._lastStructureRevision === entityManager.StructuralRevision &&
            this._lastEntityNameRevision === entityManager.EntityNameRevision &&
            this._lastActiveCameraEntityId === scene.ActiveCameraEntityId &&
            this._lastSceneName === scene.Name &&
            this._lastSelection === this._selectedEntityId
        );
    }

    _RestoreEntityFocus(entityList, focusedEntityId) {
        if (!focusedEntityId) {
            return;
        }

        for (const button of entityList.querySelectorAll("[data-entity-id]")) {
            if (button.dataset.entityId === focusedEntityId) {
                button.focus();
                break;
            }
        }
    }

    _RememberSceneState(scene, entityManager) {
        this._lastScene = scene;
        this._lastStructureRevision = entityManager.StructuralRevision;
        this._lastEntityNameRevision = entityManager.EntityNameRevision;
        this._lastActiveCameraEntityId = scene.ActiveCameraEntityId;
        this._lastSceneName = scene.Name;
        this._lastSelection = this._selectedEntityId;
    }

    _Refresh() {
        if (!this._CanPoll()) {
            return;
        }

        const scene = this._sceneManager.ActiveScene;
        const focusedEntityId = this._root.contains(document.activeElement)
            ? document.activeElement.dataset.entityId
            : null;
        const sceneName = this._root.querySelector('[data-role="scene-name"]');
        const entityList = this._root.querySelector('[data-role="entities"]');
        const empty = this._root.querySelector('[data-role="empty"]');

        if (!scene) {
            if (this._lastScene === null) {
                return;
            }

            this._ClearSceneView(sceneName, entityList, empty);
            return;
        }

        const entityManager = scene.EntityManager;

        if (this._IsSceneUnchanged(scene, entityManager)) {
            return;
        }

        const entityIds = entityManager.GetEntityIds();
        const hierarchy = this._BuildHierarchy(entityManager, entityIds);

        sceneName.textContent = scene.Name;
        this._KeepSelectionValid(
            hierarchy.entityIdSet,
            scene.ActiveCameraEntityId,
        );
        entityList.replaceChildren(
            this._RenderEntityTree(
                entityManager,
                entityIds,
                hierarchy.rootEntityIds,
                hierarchy.childrenByParentId,
            ),
        );

        this._RestoreEntityFocus(entityList, focusedEntityId);

        empty.textContent = "The scene has no entities.";
        empty.hidden = entityIds.length !== 0;

        this._RememberSceneState(scene, entityManager);
    }
}
