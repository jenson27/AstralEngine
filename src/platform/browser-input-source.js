import { AstralLogger } from "../diagnostics/logger.js";

export class BrowserInputSource {
    constructor(canvas) {
        if (!canvas || typeof canvas.addEventListener !== "function") {
            throw new TypeError(
                "BrowserInputSource requires a canvas element.",
            );
        }

        const documentObject = canvas.ownerDocument;
        const windowObject = documentObject?.defaultView;

        if (!documentObject || !windowObject) {
            throw new TypeError(
                "BrowserInputSource requires a canvas attached to a document.",
            );
        }

        this._canvas = canvas;
        this._document = documentObject;
        this._window = windowObject;
        this._keysDown = new Set();
        this._keysPressed = new Set();
        this._keysReleased = new Set();
        this._pointerDeltaX = 0;
        this._pointerDeltaY = 0;
        this._isPointerLocked = false;
        this._isStarted = false;

        this._handlers = {
            keyDown: (event) => this._HandleKeyDown(event),
            keyUp: (event) => this._HandleKeyUp(event),
            pointerDown: () => this._HandlePointerDown(),
            pointerMove: (event) => this._HandlePointerMove(event),
            pointerLockChange: () => this._HandlePointerLockChange(),
            pointerLockError: () => this._HandlePointerLockError(),
            visibilityChange: () => this._HandleVisibilityChange(),
            windowBlur: () => this._ReleaseHeldKeys(),
            canvasBlur: () => {
                if (this._document.pointerLockElement !== this._canvas) {
                    this._ReleaseHeldKeys();
                }
            },
        };

        this._eventListeners = [
            [this._window, "keydown", this._handlers.keyDown],
            [this._window, "keyup", this._handlers.keyUp],
            [this._window, "blur", this._handlers.windowBlur],
            [this._document, "mousemove", this._handlers.pointerMove],
            [
                this._document,
                "pointerlockchange",
                this._handlers.pointerLockChange,
            ],
            [
                this._document,
                "pointerlockerror",
                this._handlers.pointerLockError,
            ],
            [
                this._document,
                "visibilitychange",
                this._handlers.visibilityChange,
            ],
            [this._canvas, "pointerdown", this._handlers.pointerDown],
            [this._canvas, "blur", this._handlers.canvasBlur],
        ];
    }

    Start() {
        if (this._isStarted) {
            return;
        }

        this._isStarted = true;
        this._SetEventListeners(true);
    }

    Stop() {
        if (!this._isStarted) {
            return;
        }

        this._isStarted = false;
        this._SetEventListeners(false);

        if (this._document.pointerLockElement === this._canvas) {
            this._document.exitPointerLock();
        }

        this._ReleaseHeldKeys();
        this._keysPressed.clear();
        this._keysReleased.clear();
        this._isPointerLocked = false;
    }

    _SetEventListeners(shouldAdd) {
        for (const [target, eventType, handler] of this._eventListeners) {
            if (shouldAdd) {
                target.addEventListener(eventType, handler);
            } else {
                target.removeEventListener(eventType, handler);
            }
        }
    }

    ConsumeFrameInput() {
        const frameInput = {
            keysDown: new Set(this._keysDown),
            keysPressed: new Set(this._keysPressed),
            keysReleased: new Set(this._keysReleased),
            pointerDeltaX: this._pointerDeltaX,
            pointerDeltaY: this._pointerDeltaY,
            isPointerLocked: this._isPointerLocked,
        };

        this._keysPressed.clear();
        this._keysReleased.clear();
        this._pointerDeltaX = 0;
        this._pointerDeltaY = 0;

        return frameInput;
    }

    _HandleKeyDown(event) {
        if (!this._IsInputActive() || typeof event.code !== "string") {
            return;
        }

        if (!this._keysDown.has(event.code)) {
            this._keysDown.add(event.code);
            this._keysPressed.add(event.code);
        }
    }

    _HandleKeyUp(event) {
        if (!this._IsInputActive() || typeof event.code !== "string") {
            return;
        }

        if (this._keysDown.delete(event.code)) {
            this._keysReleased.add(event.code);
        }
    }

    _HandlePointerDown() {
        this._canvas.focus({ preventScroll: true });
        this._RequestPointerLock();
    }

    _RequestPointerLock() {
        if (
            this._document.pointerLockElement === this._canvas ||
            typeof this._canvas.requestPointerLock !== "function"
        ) {
            return;
        }

        try {
            const request = this._canvas.requestPointerLock();
            request?.catch?.((error) => {
                AstralLogger.Warn("Pointer lock request failed.", error);
            });
        } catch (error) {
            AstralLogger.Warn("Pointer lock request failed.", error);
        }
    }

    _HandlePointerMove(event) {
        if (!this._isPointerLocked) {
            return;
        }

        if (Number.isFinite(event.movementX)) {
            this._pointerDeltaX += event.movementX;
        }

        if (Number.isFinite(event.movementY)) {
            this._pointerDeltaY += event.movementY;
        }
    }

    _HandlePointerLockChange() {
        const isPointerLocked =
            this._document.pointerLockElement === this._canvas;

        if (isPointerLocked !== this._isPointerLocked) {
            this._pointerDeltaX = 0;
            this._pointerDeltaY = 0;
        }

        this._isPointerLocked = isPointerLocked;

        if (!this._isPointerLocked) {
            this._ReleaseHeldKeys();
        }
    }

    _HandlePointerLockError() {
        AstralLogger.Warn("The browser could not lock the pointer.");
    }

    _HandleVisibilityChange() {
        if (this._document.visibilityState === "hidden") {
            this._ReleaseHeldKeys();
        }
    }

    _ReleaseHeldKeys() {
        for (const keyCode of this._keysDown) {
            this._keysReleased.add(keyCode);
        }

        this._keysDown.clear();
        this._pointerDeltaX = 0;
        this._pointerDeltaY = 0;
    }

    _IsInputActive() {
        return (
            this._document.activeElement === this._canvas ||
            this._document.pointerLockElement === this._canvas
        );
    }
}
