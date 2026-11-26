import assert from "node:assert/strict";
import test from "node:test";
import { CreateSceneComponentRegistry } from "../../src/components/register-scene-components.js";
import { HitPoints } from "../../src/components/gameplay/hit-points.js";
import { PlayerControlled } from "../../src/components/gameplay/player-controlled.js";
import { CreateEditorComponentAuthoringCatalog } from "../../src/editor/component-authoring-catalog.js";
import { NeutrophilGame } from "../../src/games/neutrophil-game.js";
import { SpriteActionRegistry } from "../../src/systems/sprite-action-registry.js";
import { SpriteGameplayInputSystem } from "../../src/systems/sprite-gameplay-input-system.js";

test("Neutrophil game registers HitPoints scene and editor metadata", () => {
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
    assert.deepEqual(
        sceneTypes.SerializeComponent(playerControlled).data,
        {},
    );
    const hitPoints = sceneTypes.CreateComponent(
        "hitPoints",
        { current: 20, maximum: 30 },
    ).component;

    assert.ok(hitPoints instanceof HitPoints);
    assert.deepEqual(sceneTypes.SerializeComponent(hitPoints).data, {
        current: 20,
        maximum: 30,
    });

    const authoringCatalog = CreateEditorComponentAuthoringCatalog();
    NeutrophilGame.RegisterEditorComponents(authoringCatalog);
    assert.equal(
        authoringCatalog.GetByType(PlayerControlled).title,
        "Player Controlled",
    );
    assert.ok(
        authoringCatalog.GetByType(PlayerControlled).create() instanceof
            PlayerControlled,
    );
    assert.equal(authoringCatalog.GetByType(HitPoints).title, "Hit Points");
    assert.ok(authoringCatalog.GetByType(HitPoints).create() instanceof HitPoints);
    assert.ok(NeutrophilGame.CreateSystems()[0].system instanceof SpriteGameplayInputSystem);
});

test("Neutrophil game action validates and applies its own payload", () => {
    const actions = new SpriteActionRegistry();
    NeutrophilGame.RegisterSpriteActions(actions);
    const target = new HitPoints(40, 100);
    const scene = {
        EntityManager: {
            GetComponent: (entityId, componentType) =>
                entityId === "target" && componentType === HitPoints
                    ? target
                    : null,
        },
    };

    actions.Invoke("AttackImpact", {
        scene,
        entityId: "attacker",
        payload: { targetEntityId: "target", damage: 12 },
    });

    assert.equal(target.current, 28);
    assert.throws(
        () => actions.Invoke("AttackImpact", {
            scene,
            entityId: "attacker",
            payload: { targetEntityId: "target", damage: -1 },
        }),
        /non-negative number/,
    );
});
