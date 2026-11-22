import { AssetHandle } from "../../core/assets/asset-handle.js";
import { ModelAsset } from "../../graphics/model-asset.js";

function ValidateModelHandle(modelHandle) {
    if (!(modelHandle instanceof AssetHandle)) {
        throw new TypeError("ModelRenderer requires a model asset handle.");
    }

    if (!(modelHandle.Current instanceof ModelAsset)) {
        throw new TypeError("Model handle must contain a ModelAsset.");
    }

    return modelHandle;
}

export class ModelRenderer {
    constructor(modelHandle) {
        this._modelHandle = ValidateModelHandle(modelHandle);
    }

    SetModelHandle(modelHandle) {
        this._modelHandle = ValidateModelHandle(modelHandle);
    }

    get ModelHandle() {
        return this._modelHandle;
    }

    get Model() {
        return this._modelHandle.Current;
    }
}
