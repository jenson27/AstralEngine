# Input

## Purpose

`BrowserInputSource` reads keyboard, pointer, focus, and pointer-lock events from the browser. `InputManager` maps keyboard codes to named actions and exposes a snapshot to systems. It does not implement game controls; `CameraControlSystem` uses the input service to move the active camera. See [Camera](../components/graphics/CAMERA_README.md) for those controls.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `BrowserInputSource(canvas)` | Collects browser events and returns one frame's input state |
| `InputManager(inputSource, actionMap)` | Validates an action map and queries named action state |
| `CameraControlSystem` | Reads movement actions and pointer delta during fixed updates |
| `assets/input/default.input-map.json` | Defines the current keyboard bindings |

## Action map

- The map has `version: 1` and a non-empty `actions` object
- Each action defines a non-empty `bindings` array
- Each current binding has `device: "keyboard"` and a non-empty browser `code`
- An action can have multiple bindings; any active binding activates the action
- The current file maps movement to WASD and arrow keys, `run` to left Shift, and `jump` to Space
- Duplicate bindings are allowed; duplicate action names cannot occur in a JSON object
- An unknown action name throws `RangeError`

## Input API

| Member | Behaviour |
| --- | --- |
| `BrowserInputSource.Start()` / `Stop()` | Adds or removes listeners; repeated calls in the current state do nothing |
| `BrowserInputSource.ConsumeFrameInput()` | Returns copies of key sets, pointer delta, and pointer-lock state, then clears pressed/released edges and pointer delta |
| `InputManager.Update()` | Replaces its current snapshot with input consumed from the source |
| `IsActionDown(actionName)` | Returns whether any binding is held |
| `WasActionPressed(actionName)` / `WasActionReleased(actionName)` | Returns whether a binding changed state in the consumed snapshot |
| `GetPointerDelta()` | Returns `{ x, y }` movement accumulated since the last consume |
| `IsPointerLocked()` | Returns the snapshot's pointer-lock state |

## Browser behavior

- Keyboard input is collected only while the canvas is focused or pointer-locked
- A pointer down focuses the canvas and requests pointer lock when the browser supports it
- Pointer-lock request failures are logged as warnings
- Pointer movement is accumulated only while input is active
- Window blur, hidden document state, canvas blur outside pointer lock, and pointer-lock loss release held keys
- `Stop()` removes listeners, exits pointer lock for this canvas, and clears held and edge state
- The browser source requires a canvas attached to a document with a window

## Update order

1. Browser events update the source's held keys, key edges, and pointer delta
2. The application calls `InputManager.Update()` from its fixed-update callback
3. Systems query the snapshot during that fixed update
4. The next `ConsumeFrameInput()` clears key edges and pointer delta

- Held keys remain active across consumes until a key-up or focus-loss event
- If several fixed steps run in one browser frame, transient pressed/released edges and pointer delta are available to the first consume only

## Current scope

- The action map supports keyboard bindings only
- There is no gamepad, touch, rebinding, or analog-axis API
- Browser key codes use `KeyboardEvent.code`, not localized key labels

## Source

- `src/platform/browser-input-source.js`
- `src/core/input/input-manager.js`
- `src/systems/camera-control-system.js`
- `assets/input/default.input-map.json`
