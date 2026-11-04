import { Transform } from "../components/transform.js";

export class TransformSnapshotSystem {
    FixedUpdate(scene) {
        const entityManager = scene.EntityManager;

        for (const entityId of entityManager.Query(Transform)) {
            const transform = entityManager.GetComponent(
                entityId,
                Transform,
            );
            transform.CapturePreviousState();
        }
    }
}
