// This file defines a BrowserPlatform class that manages a canvas element in a web browser environment.
// It ensures the canvas resizes appropriately when the window size changes,
// maintaining the correct aspect ratio and pixel density.

export class BrowserPlatform {
    constructor(canvas) {
        // Ensure the provided canvas is a valid HTMLCanvasElement
        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new TypeError("BrowserPlatform requires a canvas element.");
        }

        this._canvas = canvas;
        this._resizeObserver = new ResizeObserver(() => this.ResizeCanvas());
        this._windowResizeHandler = () => this.ResizeCanvas();
        this._devicePixelRatioQuery = null;
        this._devicePixelRatioChangeHandler = () => {
            this.ResizeCanvas();
            this._WatchDevicePixelRatio();
        };
    }

    get Canvas() {
        return this._canvas;
    }

    Start() {
        this._resizeObserver.observe(this._canvas);
        window.addEventListener("resize", this._windowResizeHandler);
        this._WatchDevicePixelRatio();
        this.ResizeCanvas();
    }

    Stop() {
        this._resizeObserver.disconnect();
        window.removeEventListener("resize", this._windowResizeHandler);

        this._devicePixelRatioQuery?.removeEventListener(
            "change",
            this._devicePixelRatioChangeHandler,
        );
        this._devicePixelRatioQuery = null;
    }

    // Resize the canvas to match its displayed size in the browser, taking into account the device pixel ratio.
    ResizeCanvas() {
        const bounds = this._canvas.getBoundingClientRect();
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.max(1, Math.round(bounds.width * pixelRatio));
        const height = Math.max(1, Math.round(bounds.height * pixelRatio));

        if (this._canvas.width !== width) {
            this._canvas.width = width;
        }

        if (this._canvas.height !== height) {
            this._canvas.height = height;
        }
    }

    // Watch for changes in the device pixel ratio and resize the canvas accordingly.
    _WatchDevicePixelRatio() {
        this._devicePixelRatioQuery?.removeEventListener(
            "change",
            this._devicePixelRatioChangeHandler,
        );

        const pixelRatio = window.devicePixelRatio || 1;
        this._devicePixelRatioQuery = window.matchMedia(
            `(resolution: ${pixelRatio}dppx)`,
        );
        this._devicePixelRatioQuery.addEventListener(
            "change",
            this._devicePixelRatioChangeHandler,
        );
    }
}
