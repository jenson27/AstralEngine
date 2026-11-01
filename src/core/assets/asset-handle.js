export class AssetHandle {
    constructor(assetId) {
        if (typeof assetId !== "string" || assetId.trim() === "") {
            throw new TypeError("Asset handle requires an asset ID.");
        }

        this._assetId = assetId;
        this._asset = undefined;
        this._version = 0;
    }

    get AssetId() {
        return this._assetId;
    }

    get Version() {
        return this._version;
    }

    get Current() {
        if (this._asset === undefined) {
            throw new Error(
                `Asset "${this._assetId}" is not currently loaded.`,
            );
        }

        return this._asset;
    }

    _Replace(asset) {
        if (asset === undefined || asset === null) {
            throw new TypeError("An asset handle cannot hold an empty asset.");
        }

        const previousAsset = this._asset;
        this._asset = asset;
        this._version += 1;

        return previousAsset;
    }

    _Clear(asset) {
        if (this._asset === asset) {
            this._asset = undefined;
        }
    }
}
