import { HitPoints } from "../components/gameplay/hit-points.js";
import { PlayerControlled } from "../components/gameplay/player-controlled.js";
import { AstralLogger } from "../diagnostics/logger.js";
import { SystemPhase } from "../core/scene/system-scheduler.js";
import { SpriteGameplayInputSystem } from "../systems/sprite-gameplay-input-system.js";

function ValidateAttackImpactPayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new TypeError("Attack impact payload must be an object.");
    }
    if (
        typeof payload.targetEntityId !== "string" ||
        payload.targetEntityId.trim() === ""
    ) {
        throw new TypeError("Attack impact targetEntityId must be a non-empty string.");
    }
    if (!Number.isFinite(payload.damage) || payload.damage < 0) {
        throw new RangeError("Attack impact damage must be a non-negative number.");
    }

    return {
        targetEntityId: payload.targetEntityId,
        damage: payload.damage,
    };
}

export const NeutrophilGame = Object.freeze({
    AssetManifestUrl: "/assets/asset-manifest.json",
    InputMapUrl: "/assets/inputs/default.input-map.json",
    StartSceneUrl: "/assets/scenes/main.scene.json",

    RegisterSceneTypes(registry) {
        registry.Register(
            "playerControlled",
            PlayerControlled,
            () => new PlayerControlled(),
            {
                Version: 1,
                Serialize: () => ({}),
            },
        );
        registry.Register(
            "hitPoints",
            HitPoints,
            (data) => new HitPoints(data.current, data.maximum),
            {
                Version: 1,
                Serialize: (hitPoints) => ({
                    current: hitPoints.current,
                    maximum: hitPoints.maximum,
                }),
            },
        );
    },

    RegisterEditorComponents(catalog) {
        catalog.Register("playerControlled", PlayerControlled, {
            title: "Player Controlled",
            create: () => new PlayerControlled(),
        });
        catalog.Register("hitPoints", HitPoints, {
            title: "Hit Points",
            create: () => new HitPoints(),
        });
    },

    RegisterSpriteActions(registry) {
        registry.Register("AttackImpact", ({ scene, entityId, payload }) => {
            const { targetEntityId, damage } =
                ValidateAttackImpactPayload(payload);
            const target = scene.EntityManager.GetComponent(
                targetEntityId,
                HitPoints,
            );
            if (!target) {
                throw new Error(
                    `Attack target has no HitPoints component: ${targetEntityId}`,
                );
            }
            const remainingHitPoints = target.ApplyDamage(damage);
            AstralLogger.Info("Sprite attack impact applied.", {
                attackerEntityId: entityId,
                targetEntityId,
                damage,
                remainingHitPoints,
            });
        });
    },

    CreateSystems() {
        return [
            {
                phase: SystemPhase.FixedUpdate,
                system: new SpriteGameplayInputSystem(),
            },
        ];
    },
});
