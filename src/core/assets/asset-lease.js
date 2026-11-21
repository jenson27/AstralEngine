export class AssetLease {
    constructor(handle, release) {
        this._handle = handle;
        this._release = release;
        this._isReleased = false;
    }

    get Asset() {
        if (this._isReleased) {
            throw new Error("Cannot access a released asset lease.");
        }

        return this._handle.Current;
    }

    get Handle() {
        if (this._isReleased) {
            throw new Error("Cannot access a released asset lease.");
        }

        return this._handle;
    }

    Release() {
        if (this._isReleased) {
            return;
        }

        this._isReleased = true;
        const release = this._release;
        this._release = null;

        return release();
    }
}
