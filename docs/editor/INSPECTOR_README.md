# Inspector

## Purpose

`InspectorPanel` displays and edits the selected entity in the active scene. It provides component fields, component and entity authoring controls, and undo/redo buttons. It does not serialize scenes itself; the editor document adapter handles import and export. See [Editor Panels](PANELS_README.md) and [Transform Hierarchy](../core/TRANSFORM_HIERARCHY_README.md) for context.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `InspectorPanel` | Displays the selected entity and coordinates inspector actions |
| `InspectorPanel.Dispose()` | Stops refresh work and removes listeners |
| `EditorSelection.Select()` / `Clear()` / `Subscribe()` | Stores the selected scene entity and notifies listeners |
| `EditorComponentAuthoringCatalog.Register()` / `GetInspectorByType()` | Stores component authoring, inspector, and asset reference definitions |
| `InspectorEditController.ApplyInput()` / `RestoreRejectedInput()` | Applies field edits and restores rejected input |
| `InspectorAssetAccess.GetOptions()` / `RequireType()` / `AcquireHandle()` | Lists, validates, and acquires typed assets |
| `EditorComponentAuthoringCatalog.GetAddable()` / `Create()` / `CanRemove()` | Lists valid component choices and applies component rules |
| `EditorSceneAuthoringController.AddComponent()` / `RemoveComponent()` / `DeleteEntity()` | Performs component and entity changes |
| `EditorCommandHistory.RecordApplied()` / `Undo()` / `Redo()` / `SetScene()` | Stores and replays editor changes for one scene |
| `EditorSceneAssetTracker.Refresh()` / `Dispose()` | Retains live and history asset references in the active scene scope |
| `SceneManager.RetainActiveAssetHandles()` | Applies the current asset set to the active scene scope |
| `TransformInspector` | Edits position, rotation, and scale |
| `ParentInspector` | Displays the parent entity ID |
| `AngularVelocityInspector` | Edits angular velocity |
| `CameraInspector` | Edits projection and camera settings |
| `CameraControllerInspector` | Edits camera movement and look settings |
| `MeshRendererInspector` | Edits mesh and material asset references |
| `ModelRendererInspector` | Selects a registered model asset and prepares its handle before the edit commits |
| `SpriteRendererInspector` | Edits sprite billboard mode, tint, and render order |
| `SpriteAnimatorInspector` | Selects a sprite animation asset and initial clip |
| `field-controls.js` | Creates inspector inputs, vector groups, read-only fields, and validation messages |

## Selection and refresh

- The panel shows an empty message when there is no valid selection
- A selection belongs to a scene and entity ID; the panel only inspects it when that scene is active
- If the selected entity no longer exists, the panel clears the selection
- Selection changes trigger an immediate refresh
- The panel also refreshes every 250 milliseconds
- The panel rebuilds its fields when the selected entity, scene, or component structure changes
- Other refreshes synchronize field values while preserving the input currently being edited
- The asset tracker refreshes when the active scene or editor history changes

## Component fields

- The panel displays entity name and active state
- It displays each component on the entity and its enabled state when that component can be disabled
- `TransformInspector` displays position and scale as vectors and displays rotation in degrees
- `ParentInspector` displays the parent entity ID as read-only
- `CameraInspector` shows perspective or orthographic fields based on the projection setting
- `MeshRendererInspector` lists mesh and material assets from the asset catalog
- `ModelRendererInspector` lists model assets; it validates the selected type and acquires its handle before committing the edit
- If no model asset options are available, `ModelRendererInspector` shows the current model asset ID as read-only
- `SpriteRendererInspector` edits spherical or cylindrical billboarding, four tint channels, and render order
- `SpriteAnimatorInspector` lists registered sprite-animation assets and the selected asset's clips; it can use the asset's default clip
- If no sprite-animation asset options are available, `SpriteAnimatorInspector` shows the current asset ID as read-only
- The camera component on the active camera entity cannot be disabled or removed
- `Transform` and `Parent` cannot be disabled or removed
- A component without a registered inspector definition still has a component section, but no custom fields

## Editing and history

- Field edits are applied when the input changes
- Component definitions validate and apply their own values
- Rejected edits restore the displayed value and show a field error
- The edit controller captures the previous and next state; unchanged values do not create history entries
- Async asset edits prepare assets before commit and keep the inspector busy until preparation finishes
- Before commit, `InspectorEditController` checks that the active scene, selection, component instance, and input still match the original edit
- Inspector history retains asset IDs from both the previous and next component states
- The asset tracker keeps IDs used by live components or undo and redo entries; it releases other scene leases
- Undo and redo are disabled while an edit or authoring operation is busy
- `EditorCommandHistory` retains up to 100 entries by default
- Changing the history scene clears its undo and redo entries

## Component and entity authoring

- The component list only offers types that are not already present and whose required components are present
- Adding `Model Renderer` requires an existing `Transform` and a registered asset with `typeId: "model"`
- Adding `Sprite Renderer` requires an existing `Transform`
- Adding `Sprite Animator` requires existing `Transform` and `SpriteRenderer` components plus a registered asset with `typeId: "sprite-animation"`
- The catalog defines which components can be created or removed
- Add and remove actions create history entries
- `Delete Entity` deletes the selected entity and its descendants
- Deleting an entity hierarchy creates a history entry that can restore the hierarchy
- Add, remove, and delete history entries retain the asset IDs needed to restore their components
- The inspector reports authoring errors in its status area

## Current scope

- Built-in inspector definitions exist for Transform, Parent, Angular Velocity, Camera, Camera Controller, Mesh Renderer, Model Renderer, Sprite Renderer, and Sprite Animator
- Components need a registered inspector definition to display editable fields
- Asset-bearing components expose references through `GetSceneAssetReferences()` or a catalog `getAssetIds` function so the tracker can retain their handles
- The inspector does not import or export scene documents; the editor document adapter does that
- Mesh and material selection requires an available asset catalog

## Source

- `src/editor/panels/inspector/panel.js`
- `src/editor/panels/inspector/component-view.js`
- `src/editor/panels/inspector/field-controls.js`
- `src/editor/panels/inspector/field-ids.js`
- `src/editor/panels/inspector/edit-controller.js`
- `src/editor/panels/inspector/component-registry.js`
- `src/editor/panels/inspector/asset-access.js`
- `src/editor/panels/inspector/component-value-utils.js`
- `src/editor/panels/inspector/components/transform-inspector.js`
- `src/editor/panels/inspector/components/parent-inspector.js`
- `src/editor/panels/inspector/components/angular-velocity-inspector.js`
- `src/editor/panels/inspector/components/camera-inspector.js`
- `src/editor/panels/inspector/components/camera-controller-inspector.js`
- `src/editor/panels/inspector/components/mesh-renderer-inspector.js`
- `src/editor/panels/inspector/components/model-renderer-inspector.js`
- `src/editor/component-authoring/model-renderer-authoring.js`
- `src/editor/panels/inspector/components/sprite-renderer-inspector.js`
- `src/editor/panels/inspector/components/sprite-animator-inspector.js`
- `src/editor/component-authoring/sprite-animator-authoring.js`
- `src/editor/editor-selection.js`
- `src/editor/editor-command-history.js`
- `src/editor/editor-scene-asset-tracker.js`
- `src/core/scene/scene-manager.js`
- `src/editor/component-authoring-catalog.js`
- `src/editor/scene-authoring-controller.js`
