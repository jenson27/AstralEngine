import assert from "node:assert/strict";
import test from "node:test";
import { CreateSceneComponentRegistry } from "../../src/components/register-scene-components.js";
import { HitPoints } from "../../src/components/gameplay/hit-points.js";
import { PlayerControlled } from "../../src/components/gameplay/player-controlled.js";
import { CreateEditorComponentAuthoringCatalog } from "../../src/editor/component-authoring-catalog.js";
import { NeutrophilGame } from "../../src/games/neutrophil-game.js";
import { Scene } from "../../src/core/scene/scene.js";
import { SpriteActionRegistry } from "../../src/systems/sprite-action-registry.js";
import { SpriteGameplayInputSystem } from "../../src/systems/sprite-gameplay-input-system.js";

test("registers version 1 scene and editor component metadata", () => {
    const sceneTypes = CreateSceneComponentRegistry();
    assert.throws(
        () => sceneTypes.CreateComponent("hitPoints", { current: 20, maximum: 30 }),
        /Unknown component type ID/,
    );

    NeutrophilGame.RegisterSceneTypes(sceneTypes);
    const playerControlled = sceneTypes.CreateComponent(
        "playerControlled",
        {},
    ).component;
    assert.ok(playerControlled instanceof PlayerControlled);
    assert.deepEqual(sceneTypes.SerializeComponent(playerControlled), {
        typeId: "playerControlled",
        version: 1,
        data: {},
    });

    const hitPoints = sceneTypes.CreateComponent(
        "hitPoints",
        { current: 20, maximum: 30 },
    ).component;
    assert.ok(hitPoints instanceof HitPoints);
    assert.deepEqual(sceneTypes.SerializeComponent(hitPoints), {
        typeId: "hitPoints",
        version: 1,
        data: { current: 20, maximum: 30 },
    });

    const authoringCatalog = CreateEditorComponentAuthoringCatalog();
    NeutrophilGame.RegisterEditorComponents(authoringCatalog);
    assert.equal(
        authoringCatalog.GetByType(PlayerControlled).title,
        "Player Controlled",
    );
    assert.ok(authoringCatalog.GetByType(PlayerControlled).create() instanceof PlayerControlled);
    assert.equal(authoringCatalog.GetByType(HitPoints).title, "Hit Points");
    assert.ok(authoringCatalog.GetByType(HitPoints).create() instanceof HitPoints);
    assert.ok(
        NeutrophilGame.CreateSystems({
            input: { WasActionPressed() {} },
            QueueSpriteAnimationEvent() {},
        })[0].system instanceof SpriteGameplayInputSystem,
    );
});

test("attack impact changes HitPoints on a real scene entity", () => {
    const actions = new SpriteActionRegistry();
    NeutrophilGame.RegisterSpriteActions(actions);

    const scene = new Scene("neutrophil-action-test");
    const attackerId = "00000000-0000-4000-8000-000000000001";
    const targetId = "00000000-0000-4000-8000-000000000002";
    scene.EntityManager.CreateEntity(attackerId, "Attacker");
    scene.EntityManager.CreateEntity(targetId, "Target");
    const target = new HitPoints(40, 100);
    scene.EntityManager.AddComponent(targetId, HitPoints, target);
    scene.Initialize();

    try {
        actions.Invoke("AttackImpact", {
            scene,
            entityId: attackerId,
            payload: { targetEntityId: targetId, damage: 12 },
        });
        assert.equal(scene.EntityManager.GetComponent(targetId, HitPoints).current, 28);
        assert.throws(
            () => actions.Invoke("AttackImpact", {
                scene,
                entityId: attackerId,
                payload: { targetEntityId: targetId, damage: -1 },
            }),
            /non-negative number/,
        );
        assert.throws(
            () => actions.Invoke("AttackImpact", {
                scene,
                entityId: attackerId,
                payload: { targetEntityId: attackerId, damage: 1 },
            }),
            /has no HitPoints component/,
        );
    } finally {
        scene.Dispose();
    }
});
