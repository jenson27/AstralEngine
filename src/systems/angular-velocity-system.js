import { Transform } from "../components/transform.js";
import { AngularVelocity } from "../components/angular-velocity.js";

export class AngularVelocitySystem {
    FixedUpdate(scene, { deltaTime }) {
        const entityManager = scene.EntityManager;

        for (const entityId of entityManager.Query(Transform, AngularVelocity)) {
            const transform = entityManager.GetComponent(entityId, Transform);
            const angularVelocity = entityManager.GetComponent(
                entityId,
                AngularVelocity,
            );

            transform.rotation[0] += angularVelocity.x * deltaTime;
            transform.rotation[1] += angularVelocity.y * deltaTime;
            transform.rotation[2] += angularVelocity.z * deltaTime;
        }
    }
}
