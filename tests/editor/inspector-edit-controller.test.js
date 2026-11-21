import assert from "node:assert/strict";
import test from "node:test";
import { MeshRenderer } from "../../src/components/graphics/mesh-renderer.js";
import { EditorCommandHistory } from "../../src/editor/editor-command-history.js";
import { EditorSelection } from "../../src/editor/editor-selection.js";
import {
    CreateEditorComponentAuthoringCatalog,
    EditorComponentAuthoringCatalog,
} from "../../src/editor/component-authoring-catalog.js";
import { EditorSceneAssetTracker } from "../../src/editor/editor-scene-asset-tracker.js";
import { InspectorEditController } from "../../src/editor/panels/inspector/edit-controller.js";

const ENTITY_ID = "10203040-aaaa-4aaa-8aaa-102030405060";
const OTHER_ENTITY_ID = "20304050-bbbb-4bbb-9bbb-203040506070";
const COMPONENT_KEY = "component-0";

class AssetComponent {
    constructor(assetId) {
        this.assetId = assetId;
    }
}

function CreateHarness(inspector) {
    const componentsByEntity = new Map([
        [ENTITY_ID, new AssetComponent("mesh:old")],
        [OTHER_ENTITY_ID, new AssetComponent("mesh:other")],
    ]);
    const scene = {
        EntityManager: {
            GetEntityName(entityId) {
                if (!componentsByEntity.has(entityId)) {
                    throw new Error("Entity does not exist.");
                }
                return entityId;
            },
            GetComponent(entityId, componentType) {
                return componentType === AssetComponent
                    ? componentsByEntity.get(entityId)
                    : undefined;
            },
        },
    };
    const sceneManager = {
        ActiveScene: scene,
    };
    const selection = new EditorSelection();
    selection.Select(scene, ENTITY_ID);
    const history = new EditorCommandHistory();
    history.SetScene(scene);
    const componentCatalog = new EditorComponentAuthoringCatalog();
    componentCatalog.Register("assetComponent", AssetComponent, {
        title: "Asset Component",
        inspector,
        getAssetIds: ({ component, state }) => {
            const assetId = state?.assetId ?? component?.assetId;
            return assetId ? [assetId] : [];
        },
    });
    const controller = new InspectorEditController({
        sceneManager,
        selection,
        history,
        componentCatalog,
        componentTypesByKey: new Map([[COMPONENT_KEY, AssetComponent]]),
    });
    const input = {
        dataset: { inspectorField: "assetComponent.assetId" },
        value: "mesh:new",
        isConnected: true,
        closest: () => ({ dataset: { componentKey: COMPONENT_KEY } }),
    };

    return {
        component: componentsByEntity.get(ENTITY_ID),
        controller,
        history,
        input,
        scene,
        selection,
    };
}

function CreateEditableInspector() {
    return {
        title: "Asset Component",
        fieldPrefix: "assetComponent.",
        capture: ({ component }) => ({ assetId: component.assetId }),
        restore: ({ component, value }) => {
            component.assetId = value.assetId;
        },
        apply: ({ component, input }) => {
            component.assetId = input.value;
        },
        equals: (left, right) => left.assetId === right.assetId,
        getEditLabel: () => "Change asset",
    };
}

test("retains both asset references across inspector undo and redo", async () => {
    const harness = CreateHarness(CreateEditableInspector());

    await harness.controller.ApplyInput(
        harness.scene,
        ENTITY_ID,
        harness.input,
    );

    assert.equal(harness.component.assetId, "mesh:new");
    assert.deepEqual(harness.history.GetRetainedAssetIds(), [
        "mesh:old",
        "mesh:new",
    ]);

    await harness.history.Undo();
    assert.equal(harness.component.assetId, "mesh:old");
    await harness.history.Redo();
    assert.equal(harness.component.assetId, "mesh:new");
});

test("does not commit a prepared inspector edit after selection changes", async () => {
    let resolvePreparation;
    let didCommit = false;
    const preparation = new Promise((resolve) => {
        resolvePreparation = resolve;
    });
    const inspector = {
        ...CreateEditableInspector(),
        apply: undefined,
        prepareApply: () => preparation,
    };
    const harness = CreateHarness(inspector);

    const apply = harness.controller.ApplyInput(
        harness.scene,
        ENTITY_ID,
        harness.input,
    );
    harness.selection.Select(harness.scene, OTHER_ENTITY_ID);
    resolvePreparation({
        Commit() {
            didCommit = true;
        },
    });

    await assert.rejects(apply, /Scene, selection, or Inspector field changed/);
    assert.equal(didCommit, false);
    assert.equal(harness.history.CanUndo, false);
});

test("tracks live component assets and history-only asset references", async () => {
    const scene = {};
    const history = new EditorCommandHistory();
    history.SetScene(scene);
    let liveAssetIds = ["mesh:live"];
    const retainedSnapshots = [];
    const tracker = new EditorSceneAssetTracker({
        sceneManager: {
            ActiveScene: scene,
            async RetainActiveAssetHandles(activeScene, assetIds) {
                assert.strictEqual(activeScene, scene);
                retainedSnapshots.push(assetIds);
                return true;
            },
        },
        history,
        componentCatalog: {
            GetAssetIds: () => liveAssetIds,
        },
    });

    await tracker.Refresh();
    assert.deepEqual(retainedSnapshots.at(-1), ["mesh:live"]);

    liveAssetIds = [];
    history.RecordApplied({
        scene,
        label: "Keep asset for undo",
        undo: () => {},
        redo: () => {},
        retainedAssetIds: ["mesh:history"],
    });
    await tracker.Refresh();
    assert.deepEqual(retainedSnapshots.at(-1), ["mesh:history"]);

    history.SetScene(null);
    await tracker.Refresh();
    assert.deepEqual(retainedSnapshots.at(-1), []);
    tracker.Dispose();
});

test("combines built-in inspector metadata and Mesh Renderer asset references", () => {
    const catalog = CreateEditorComponentAuthoringCatalog();
    const component = {
        MeshHandle: { AssetId: "mesh:cube" },
        MaterialHandlesBySlot: {
            body: { AssetId: "material:stone" },
        },
    };
    const scene = {
        EntityManager: {
            GetEntityIds: () => [ENTITY_ID],
            GetComponentEntries: () => [
                { componentType: MeshRenderer, component },
            ],
        },
    };

    assert.equal(catalog.GetInspectorByType(MeshRenderer).title, "Mesh Renderer");
    assert.deepEqual(catalog.GetAssetIds(scene), [
        "mesh:cube",
        "material:stone",
    ]);
    assert.deepEqual(
        catalog.GetAssetIdsForState(MeshRenderer, {
            meshHandle: { AssetId: "mesh:sphere" },
            materialHandlesBySlot: {
                body: { AssetId: "material:wood" },
            },
        }),
        ["mesh:sphere", "material:wood"],
    );
});
