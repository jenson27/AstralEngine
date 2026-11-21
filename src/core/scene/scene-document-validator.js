import { IsEntityId } from "../ecs/entity-id.js";
import {
    ValidateActiveCameraEntity,
    ValidateSceneEntities,
} from "./scene-document-entity-validator.js";
import {
    ValidateActiveCameraTransform,
    ValidateSceneParentRelationships,
} from "./scene-document-hierarchy-validator.js";
import {
    ValidateSceneAssetIds,
    ValidateSceneAssetReferences,
} from "./scene-document-asset-validator.js";

export class SceneDocumentValidator {
    Validate(data) {
        this._ValidateDocumentShape(data);
        ValidateSceneAssetIds(data.assets);

        if (!IsEntityId(data.activeCameraEntityId)) {
            throw new TypeError(
                "Scene must define a valid active camera UUID.",
            );
        }

        const entityIds = ValidateSceneEntities(data.entities);

        ValidateActiveCameraEntity(
            data.activeCameraEntityId,
            data.entities,
        );
        ValidateSceneParentRelationships(data.entities, entityIds);
        ValidateActiveCameraTransform(data);
        ValidateSceneAssetReferences(data);

        return entityIds;
    }

    _ValidateDocumentShape(data) {
        if (!data || typeof data !== "object" || Array.isArray(data)) {
            throw new TypeError("Scene data must be an object.");
        }

        if (
            data.format !== "astral-scene" ||
            data.version !== 1
        ) {
            throw new Error("Unsupported scene format or version.");
        }

        if (typeof data.name !== "string" || data.name.trim() === "") {
            throw new TypeError("Scene name must be a non-empty string.");
        }

        if (!Array.isArray(data.entities)) {
            throw new TypeError("Scene entities must be an array.");
        }
    }
}
