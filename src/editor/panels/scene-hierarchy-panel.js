import { Parent } from "../../components/parent.js";
import { CreateElement } from "../ui/dom-utils.js";

export class SceneHierarchyPanel {
    constructor(sceneManager, selection, rootElement, authoringController) {
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

        if (
            !selection ||
            typeof selection.Select !== "function" ||
            typeof selection.Clear !== "function" ||
            typeof selection.Subscribe !== "function"
        ) {
            throw new TypeError("SceneHierarchyPanel requires editor selection.");
        }
        if (
            !authoringController ||
            typeof authoringController.CreateEntity !== "function"
        ) {
            throw new TypeError(
                "SceneHierarchyPanel requires scene authoring.",
            );
        }

        this._sceneManager = sceneManager;
        this._selection = selection;
        this._authoringController = authoringController;
        this._root = rootElement;
        this._root.classList.add("hierarchy-panel");
        this._refreshTimer = null;
        this._lastScene = undefined;
        this._lastStructureRevision = null;
        this._lastEntityNameRevision = null;
        this._lastEntityStateRevision = null;
        this._lastActiveCameraEntityId = undefined;
        this._lastSceneName = undefined;
        this._lastSelection = undefined;
        this._root.innerHTML = `
            <div class="hierarchy-toolbar">
                <div class="hierarchy-scene-label">
                    <span data-role="scene-name"></span>
                </div>
                <button type="button" data-action="create-entity">Create Entity</button>
            </div>
            <span class="hierarchy-authoring-status" data-role="authoring-status" role="status" aria-live="polite"></span>
            <div class="hierarchy-entity-list" data-role="entities" role="list" aria-label="Scene entities"></div>
            <div class="hierarchy-empty" data-role="empty" hidden></div>`;

        this._onClick = this._HandleClick.bind(this);
        this._root.addEventListener("click", this._onClick);
        this._unsubscribeSelection = this._selection.Subscribe(() =>
            this._Refresh(),
        );
        this._Refresh();
        this._UpdateRefreshTimer();
    }

    Dispose() {
        if (this._refreshTimer !== null) {
            globalThis.clearInterval(this._refreshTimer);
            this._refreshTimer = null;
        }

        this._root.removeEventListener("click", this._onClick);
        this._unsubscribeSelection?.();
        this._unsubscribeSelection = null;
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
        const createButton = event.target.closest(
            '[data-action="create-entity"]',
        );
        if (createButton && this._root.contains(createButton)) {
            this._CreateEntity();
            return;
        }

        const entityButton = event.target.closest("[data-entity-id]");

        if (!entityButton || !this._root.contains(entityButton)) {
            return;
        }

        const scene = this._sceneManager.ActiveScene;
        if (!scene) {
            return;
        }

        this._selection.Select(scene, entityButton.dataset.entityId);
        this._Refresh();
    }

    _CreateEntity() {
        const status = this._root.querySelector(
            '[data-role="authoring-status"]',
        );
        status.textContent = "";
        try {
            this._authoringController.CreateEntity();
            this._Refresh();
        } catch (error) {
            status.textContent =
                error instanceof Error ? error.message : String(error);
        }
    }

    _GetSelectedEntityId(scene = this._sceneManager.ActiveScene) {
        const selection = this._selection.Current;
        return selection?.scene === scene ? selection.entityId : null;
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

    _KeepSelectionValid(entityIdSet, activeCameraEntityId, scene) {
        const selection = this._selection.Current;
        if (
            selection?.scene === scene &&
            entityIdSet.has(selection.entityId)
        ) {
            return;
        }

        const fallbackEntityId = entityIdSet.has(activeCameraEntityId)
            ? activeCameraEntityId
            : null;
        if (fallbackEntityId) {
            this._selection.Select(scene, fallbackEntityId);
        } else {
            this._selection.Clear();
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
            String(entityId === this._GetSelectedEntityId()),
        );
        button.dataset.active = String(
            entityManager.IsEntityActive?.(entityId) ?? true,
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
        this._selection.Clear();
        this._lastScene = null;
        this._lastStructureRevision = null;
        this._lastEntityNameRevision = null;
        this._lastEntityStateRevision = null;
        this._lastActiveCameraEntityId = undefined;
        this._lastSceneName = undefined;
        this._lastSelection = null;
    }

    _IsSceneUnchanged(scene, entityManager) {
        return (
            this._lastScene === scene &&
            this._lastStructureRevision === entityManager.StructuralRevision &&
            this._lastEntityNameRevision === entityManager.EntityNameRevision &&
            this._lastEntityStateRevision === entityManager.EntityStateRevision &&
            this._lastActiveCameraEntityId === scene.ActiveCameraEntityId &&
            this._lastSceneName === scene.Name &&
            this._lastSelection === this._GetSelectedEntityId(scene)
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
        this._lastEntityStateRevision = entityManager.EntityStateRevision;
        this._lastActiveCameraEntityId = scene.ActiveCameraEntityId;
        this._lastSceneName = scene.Name;
        this._lastSelection = this._GetSelectedEntityId(scene);
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
        const createButton = this._root.querySelector(
            '[data-action="create-entity"]',
        );
        const entityList = this._root.querySelector('[data-role="entities"]');
        const empty = this._root.querySelector('[data-role="empty"]');

        if (!scene) {
            if (this._lastScene === null) {
                return;
            }

            this._ClearSceneView(sceneName, entityList, empty);
            createButton.disabled = true;
            return;
        }

        createButton.disabled = this._authoringController.IsBusy;

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
            scene,
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
