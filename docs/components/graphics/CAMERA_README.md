# Camera

## Purpose

`Camera` stores perspective settings and reusable view and projection matrices. `CameraControlSystem` optionally moves the active camera when its entity also has a `CameraController`. The scene selects which camera renders; these classes do not create or activate scenes. See [Scene Management](../../core/SCENE_MANAGEMENT_README.md) and [Input](../../core/INPUT_README.md).

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `Camera()` | Builds view and perspective matrices from camera settings |
| `Camera.UpdateMatrices(transform, aspectRatio)` | Builds a view matrix from local position and rotation |
| `Camera.UpdateMatricesFromWorldMatrix(worldMatrix, aspectRatio)` | Builds a view matrix from the camera's world matrix |
| `CameraController(settings)` | Stores validated movement and look settings |
| `ValidateCameraControllerSettings(controller)` | Checks controller value ranges |
| `CameraControlSystem.Initialize()` / `Shutdown()` | Acquires and clears the input service |
| `CameraControlSystem.FixedUpdate(scene, context)` | Applies pointer look and movement to the active camera transform |
| `Scene.SetActiveCameraEntity(entityId)` | Selects an entity that has both `Camera` and `Transform` |

## Camera data and matrices

- `fieldOfView` - Vertical field of view in radians; default is π/3
- `nearPlane` - Near clipping distance; default is `0.1`
- `farPlane` - Far clipping distance; default is `100`
- `UpdateMatrices()` and `UpdateMatricesFromWorldMatrix()` return `{ viewMatrix, projectionMatrix }`
- The returned matrix arrays are owned and reused by the `Camera`; copy them to retain a snapshot
- The projection matrix is recomputed when field of view, aspect ratio, near plane, or far plane changes
- Invalid perspective values or a non-positive aspect ratio throw
- The world-matrix path requires an invertible camera transform; zero scale can make it fail
- Scene component serialization validates `0 < fieldOfView < π`, `nearPlane > 0`, and `farPlane > nearPlane`

## Camera controller settings

- `movementSpeed` - Finite value greater than or equal to zero
- `runMultiplier` - Finite value greater than or equal to one
- `lookSensitivity` - Finite value greater than or equal to zero
- `maxPitchRadians` - Finite value greater than zero and less than π/2
- Missing settings or values outside these ranges throw

## Camera controls

- The system requires the input service methods `IsActionDown()`, `GetPointerDelta()`, and `IsPointerLocked()`
- It also requires these actions to exist: `moveForward`, `moveBackward`, `moveLeft`, `moveRight`, and `run`
- Mouse look runs only while pointer-locked; pitch is clamped and yaw is wrapped to the range around ±π
- Movement follows the camera's horizontal world direction; parent transforms convert the world movement into local position changes
- Diagonal input is normalized
- Holding `run` multiplies movement speed by `runMultiplier`
- No active camera or no `CameraController` means no camera movement; a controller without `Transform` throws
- `CameraControlSystem` must be initialized by the scene before `FixedUpdate()`; otherwise it throws

## Active camera

- The active camera entity must exist and contain both `Camera` and `Transform`
- The scene loader requires `activeCameraEntityId` in every scene document
- The render system uses the active camera's world matrix so parent transforms affect the view
- A scene cannot remove or destroy its active camera until another camera is selected

## Current scope

- The controller moves on the horizontal plane and does not implement vertical movement
- Camera control is a sample system; applications can register another camera system
- Camera settings are perspective-only

## Source

- `src/components/graphics/camera.js`
- `src/components/graphics/camera-controller.js`
- `src/systems/camera-control-system.js`
- `src/math/matrix4.js`
- `src/core/scene/scene.js`
- `src/systems/render-system.js`
