export class HitPoints {
    constructor(current = 100, maximum = current) {
        if (!Number.isFinite(current) || current < 0) {
            throw new RangeError("Hit points must be non-negative.");
        }
        if (!Number.isFinite(maximum) || maximum <= 0 || current > maximum) {
            throw new RangeError("Maximum hit points must be positive and at least current hit points.");
        }
        this.current = current;
        this.maximum = maximum;
    }

    ApplyDamage(amount) {
        if (!Number.isFinite(amount) || amount < 0) {
            throw new RangeError("Damage must be non-negative.");
        }
        this.current = Math.max(0, this.current - amount);
        return this.current;
    }
}
