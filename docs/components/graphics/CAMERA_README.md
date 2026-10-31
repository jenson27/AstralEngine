# Camera

## Purpose

`Camera` stores perspective settings and creates view and projection matrices for rendering. It reads position and rotation from a caller-provided `Transform`; it does not own that transform, choose an active camera, or draw objects. See [Transform](../TRANSFORM_README.md) for the position and rotation data used by the camera.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `Camera` | Stores perspective settings and reusable view and projection matrices. |
| `constructor()` | Sets the default field of view and clipping planes and creates the matrix arrays. |
| `UpdateMatrices()` | Updates the view and projection matrices and returns references to them. |
| `SetViewMatrixFromTransform()` | Builds a view matrix from a transform's position and rotation. |
| `SetPerspectiveMatrix()` | Validates perspective settings and writes a perspective projection matrix. |

## Ownership

- Each `Camera` owns its `_viewMatrix` and `_projectionMatrix` arrays.
- `UpdateMatrices()` does not store or own the supplied `Transform`.
- Each call returns a new object that refers to the camera's existing matrix arrays.
- The matrix arrays are overwritten by later calls to `UpdateMatrices()`.

## Camera data

- `fieldOfView` - Vertical field of view in radians. Defaults to `Math.PI / 3`.
- `nearPlane` - Near clipping distance. Defaults to `0.1`.
- `farPlane` - Far clipping distance. Defaults to `100`.
- `_viewMatrix` - A 16-element `Float32Array` for the view matrix.
- `_projectionMatrix` - A 16-element `Float32Array` for the projection matrix.

## Matrix updates

- `UpdateMatrices(transform, aspectRatio)` reads `transform.position` and `transform.rotation`.
- `SetViewMatrixFromTransform()` writes the view matrix using the inverse camera rotation and position.
- `SetPerspectiveMatrix()` writes the projection matrix using `fieldOfView`, `aspectRatio`, `nearPlane`, and `farPlane`.
- The projection matrix uses WebGPU's 0-to-1 depth range.
- The matrices are stored in column-major order for WGSL.

## Invalid input

- `SetPerspectiveMatrix()` throws a `RangeError` if an input is not finite, the field of view is not between 0 and π, the aspect ratio is not positive, the near plane is not positive, or the far plane is not greater than the near plane.
- `UpdateMatrices()` updates the view matrix before it validates the projection settings. If projection settings are invalid, it throws and does not return the matrices. The projection matrix keeps its previous contents, or its initial zero values.
- The camera does not validate the supplied transform. A missing transform can cause a `TypeError`; invalid position or rotation values can produce invalid view-matrix values.

## Design choices and tradeoffs

- **Separate camera settings from `Transform`.** The transform controls camera position and rotation; the camera controls projection. The caller must provide both.
- **Reuse matrix arrays.** This avoids allocating new arrays on each update, but callers must copy a matrix if they need to keep a snapshot.
- **Use perspective projection only.** Orthographic projection is not implemented.

## Current scope

- Active camera selection is not implemented.
- Camera registration with an ECS is not implemented.
- The camera does not manage viewport size or render objects.

## Source

- `src/components/graphics/camera.js`
- `src/math/matrix4.js`
