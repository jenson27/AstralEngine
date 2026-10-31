# Transform

## Purpose

`Transform` stores an object's local position, Euler rotation, and scale. It builds a model matrix from those values when `GetModelMatrix()` is called. It does not manage parent-child hierarchies or ECS storage; game code updates it, and the renderer uses its matrix. See the [Engine Documentation](../SRC_README.md) for the documentation index.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `Transform` | Stores local position, rotation, scale, and a reusable model matrix. |
| `constructor()` | Initializes position and rotation to zero and scale to one. |
| `GetModelMatrix()` | Rebuilds and returns the model matrix from the current transform values. |
| `SetTRSMatrix()` | Writes translation, rotation, and scale into the provided matrix. |

## Ownership

- Each `Transform` owns its `position`, `rotation`, and `scale` arrays.
- Each `Transform` owns one 16-element `_modelMatrix` typed array.
- `GetModelMatrix()` returns a borrowed reference to `_modelMatrix`.
- The returned array remains the same object, but its values are overwritten by the next `GetModelMatrix()` call.

## Transform data

- `position` - Three values for X, Y, and Z position. Defaults to `[0, 0, 0]`.
- `rotation` - Three Euler angles for X, Y, and Z rotation, in radians. Defaults to `[0, 0, 0]`.
- `scale` - Three scale values for X, Y, and Z. Defaults to `[1, 1, 1]`.
- `_modelMatrix` - A 16-element `Float32Array` stored in column-major order for WGSL.

## Model matrix

- `GetModelMatrix()` passes the current transform values and `_modelMatrix` to `SetTRSMatrix()`.
- `SetTRSMatrix()` applies rotation in Z * Y * X order, then writes scale and position into the matrix.
- The matrix represents this transform's local position, rotation, and scale. It does not include a parent transform.
- The matrix is only rebuilt when `GetModelMatrix()` is called.
- The code does not validate array lengths or finite values. Invalid values can produce invalid matrix values.

## Design choices and tradeoffs

- **Reuse the matrix.** This avoids creating a new matrix on every call, but callers must not treat a returned matrix as a saved snapshot.
- **Use Euler angles.** They are simple to edit, but can have rotation limitations such as gimbal lock.

## Current scope

- `Transform` is not registered in an ECS yet.
- Parent-child transform hierarchy is not implemented.
- Camera view and projection matrices are handled by `Camera`.

## Source

- `src/components/transform.js`
- `src/math/matrix4.js`
