import { SceneBuilder } from "./scene-builder.js";
import { SceneDocumentValidator } from "./scene-document-validator.js";
import { AstralLogger } from "../../diagnostics/logger.js";
import { JsonFormat } from "../../serialization/json-format.js";

export class SceneLoader {
    constructor(
        componentRegistry,
        fetcher = globalThis.fetch?.bind(globalThis),
    ) {
        // Validate that the component registry has a DeserializeComponent method, otherwise throw an error.
        if (
            !componentRegistry ||
            typeof componentRegistry.DeserializeComponent !== "function"
        ) {
            throw new TypeError(
                "SceneLoader requires a component deserializer.",
            );
        }

        // Validate that the fetcher is a function if provided, otherwise throw an error.
        if (typeof fetcher !== "function") {
            throw new TypeError("SceneLoader requires a fetch function.");
        }

        // Store the component registry and fetcher for later use.
        this._builder = new SceneBuilder(componentRegistry);
        this._fetcher = fetcher;
        this._documentValidator = new SceneDocumentValidator();
    }

    // Load a scene from a URL, returning a Promise that resolves to the loaded Scene object.
    async Load(url, options = {}) {
        let stage = "fetch scene";
        AstralLogger.Info("Loading scene.", { url });

        try {
            const response = await this._fetcher(url, {
                signal: options.signal,
            });
            AstralLogger.Debug("Scene response received.", {
                url,
                status: response.status,
                ok: response.ok,
            });

            if (!response.ok) {
                throw new Error(
                    "Could not load scene. HTTP " + response.status + ".",
                );
            }

            stage = "read scene response body";
            const text = await response.text();

            stage = "parse scene JSON";
            let data;
            try {
                data = JsonFormat.Parse(text);
            } catch (error) {
                const parseError = new Error(
                    "Scene response is not valid JSON.",
                );
                parseError.cause = error;
                throw parseError;
            }

            stage = "build scene";
            const scene = await this.LoadDataAsync(data, options);

            AstralLogger.Info("Scene loaded.", {
                url,
                sceneName: scene.Name,
                entityCount: data.entities.length,
            });

            return scene;
        } catch (error) {
            throw new Error(
                `Scene load failed during "${stage}" for "${url}".`,
                { cause: error },
            );
        }
    }

    LoadData(data, options = {}) {
        const entityIds = this._documentValidator.Validate(data);

        if ((data.assets?.length ?? 0) > 0 && !options.assetScope) {
            throw new Error(
                "Scene data with assets requires an asset scope or LoadDataAsync().",
            );
        }

        return this._builder.Build(data, options, entityIds);
    }

    async LoadDataAsync(data, options = {}) {
        const entityIds = this._documentValidator.Validate(data);
        await this._LoadSceneAssets(
            data.assets ?? [],
            options.assetScope,
        );

        return this._builder.Build(data, options, entityIds);
    }

    async _LoadSceneAssets(assetIds, assetScope) {
        if (assetIds.length === 0) {
            return;
        }

        if (!assetScope || typeof assetScope.Acquire !== "function") {
            throw new TypeError(
                "Loading scene assets requires an asset scope.",
            );
        }

        await Promise.all(
            assetIds.map((assetId) => assetScope.Acquire(assetId)),
        );
    }

}
