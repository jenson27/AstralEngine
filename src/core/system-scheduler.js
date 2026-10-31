export const SystemPhase = Object.freeze({
    FixedUpdate: "fixed-update",
    PrepareRender: "prepare-render",
});

const systemMethodByPhase = new Map([
    [SystemPhase.FixedUpdate, "FixedUpdate"],
    [SystemPhase.PrepareRender, "PrepareRender"],
]);

export class SystemScheduler {
    constructor() {
        this._systemsByPhase = new Map([
            [SystemPhase.FixedUpdate, []],
            [SystemPhase.PrepareRender, []],
        ]);
        this._isRunning = false;
    }

    AddSystem(phase, system) {
        const methodName = systemMethodByPhase.get(phase);

        if (!methodName) {
            throw new TypeError("Unknown system phase: " + phase);
        }

        if (!system || typeof system[methodName] !== "function") {
            throw new TypeError("System must provide " + methodName + "().");
        }

        if (this._isRunning) {
            throw new Error("Cannot add a system while systems are running.");
        }

        const systems = this._systemsByPhase.get(phase);
        if (systems.includes(system)) {
            throw new Error("System is already registered for this phase.");
        }

        systems.push(system);
    }

    GetSystems() {
        return [...new Set([...this._systemsByPhase.values()].flat())];
    }

    Run(phase, scene, context) {
        const methodName = systemMethodByPhase.get(phase);
        const systems = this._systemsByPhase.get(phase);

        if (!methodName || !systems) {
            throw new TypeError("Unknown system phase: " + phase);
        }

        if (this._isRunning) {
            throw new Error("System scheduler cannot run recursively.");
        }

        this._isRunning = true;
        try {
            for (const system of systems) {
                system[methodName](scene, context);
            }
        } finally {
            this._isRunning = false;
        }
    }
}
