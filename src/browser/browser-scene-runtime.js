import { SceneLoader } from "../core/scene/scene-loader.js";
import { SceneManager } from "../core/scene/scene-manager.js";
import { SystemPhase } from "../core/scene/system-scheduler.js";
import { CreateSceneComponentRegistry } from "../components/register-scene-components.js";
import { AssetScope } from "../core/assets/asset-scope.js";
import { AngularVelocitySystem } from "../systems/angular-velocity-system.js";
import { TransformSnapshotSystem } from "../systems/transform-snapshot-system.js";
import { CameraControlSystem } from "../systems/camera-control-system.js";
import { TransformHierarchySystem } from "../systems/transform-hierarchy-system.js";
import { RenderSystem } from "../systems/render-system.js";
import { SpriteActionRegistry } from "../systems/sprite-action-registry.js";
import { SpriteAnimationEventQueue } from "../systems/sprite-animation-event-queue.js";
import { SpriteAnimationSystem } from "../systems/sprite-animation-system.js";

function CreateSystemRegistrations({
    renderer,
    inputManager,
    gameSystems,
    spriteAnimationEvents,
    spriteActionRegistry,
}) {
    return [
        {
            phase: SystemPhase.FixedUpdate,
            system: new TransformSnapshotSystem(),
        },
        {
            phase: SystemPhase.FixedUpdate,
            system: new AngularVelocitySystem(),
        },
        {
            phase: SystemPhase.FixedUpdate,
            system: new CameraControlSystem({ input: inputManager }),
        },
        ...gameSystems,
        {
            phase: SystemPhase.FixedUpdate,
            system: new SpriteAnimationSystem({
                eventQueue: spriteAnimationEvents,
                actionRegistry: spriteActionRegistry,
            }),
        },
        {
            phase: SystemPhase.PrepareRender,
            system: new TransformHierarchySystem(),
        },
        {
            phase: SystemPhase.PrepareRender,
            system: new RenderSystem(renderer),
        },
    ];
}

export function CreateBrowserSceneManager({
    renderer,
    inputManager,
    assetRuntime,
    spriteActionRegistry,
    game,
    signal = null,
}) {
    const componentRegistry = CreateSceneComponentRegistry();
    game.RegisterSceneTypes(componentRegistry);
    const sceneLoader = new SceneLoader(componentRegistry);

    return new SceneManager(
        sceneLoader,
        (_url, assetScope) => {
            const spriteAnimationEvents = new SpriteAnimationEventQueue();
            const gameSystems = game.CreateSystems({
                input: inputManager,
                QueueSpriteAnimationEvent: (entityId, eventName, payload) =>
                    spriteAnimationEvents.Enqueue(
                        entityId,
                        eventName,
                        payload,
                    ),
            });
            if (!Array.isArray(gameSystems)) {
                throw new TypeError("Game CreateSystems() must return an array.");
            }

            return {
                signal,
                systems: CreateSystemRegistrations({
                    renderer,
                    inputManager,
                    gameSystems,
                    spriteAnimationEvents,
                    spriteActionRegistry,
                }),
                componentServices: {
                    ResolveAssetHandle: (assetId, expectedTypeId) => {
                        const descriptor = assetRuntime.catalog.GetRequired(
                            assetId,
                        );
                        if (descriptor.typeId !== expectedTypeId) {
                            throw new TypeError(
                                `Asset "${assetId}" must have type "${expectedTypeId}".`,
                            );
                        }
                        return assetScope.GetHandleRequired(assetId);
                    },
                },
            };
        },
        () => new AssetScope(assetRuntime.manager),
    );
}
