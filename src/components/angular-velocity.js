export class AngularVelocity {
    constructor(x = 0, y = 0, z = 0) {
        if (![x, y, z].every(Number.isFinite)) {
            throw new TypeError("Angular velocity values must be finite.");
        }

        this.x = x;
        this.y = y;
        this.z = z;
    }
}
