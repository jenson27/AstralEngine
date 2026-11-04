# Transform

## Purpose

`Transform` stores an entity's local position, Euler rotation, and scale, and builds local and world matrices for rendering. It captures the previous fixed-update state and uses quaternion interpolation for rendered rotation between simulation steps. It does not manage parent links; `TransformHierarchySystem` combines the local matrix with the parent world matrix. See [Transform Hierarchy](../core/TRANSFORM_HIERARCHY_README.md).

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `Transform` | Stores local TRS state and reusable matrices |
| `CapturePreviousState()` / `SnapInterpolationToCurrentState()` | Set the state used as the previous interpolation sample |
| `TransformSnapshotSystem.FixedUpdate(scene)` | Captures the previous state for every entity with a `Transform` |
| `GetInterpolatedState(alpha)` | Interpolates position and scale and returns a quaternion rotation |
| `GetInterpolatedModelMatrix(alpha)` / `GetModelMatrix()` | Builds the interpolated or current local matrix |
| `UpdateWorldMatrix(parentWorldMatrix, alpha)` | Writes the interpolated local matrix or its parent-relative world matrix |
| `WorldMatrix` | Exposes the current world matrix buffer |
| `SetQuaternionFromEuler()` / `SlerpQuaternion()` | Convert and interpolate rotation quaternions |
| `SetTRSMatrix()` / `SetTRSMatrixFromQuaternion()` / `MultiplyMatrix4()` | Build and combine 4×4 matrices |

## Ownership

- The entity manager stores each `Transform` object by reference
- `Transform` owns its local arrays, interpolation state, and matrix buffers
- Matrix getters and matrix-building methods return reusable internal buffers; copy a buffer if it must be retained across updates
- `GetInterpolatedState()` returns a reusable object whose arrays change on the next call

## Transform data

- `position` - Mutable `[x, y, z]` local position
- `rotation` - Mutable `[x, y, z]` Euler angles in radians
- `scale` - Mutable `[x, y, z]` local scale; defaults to `[1, 1, 1]`
- Position and rotation default to `[0, 0, 0]`
- Scene serialization requires each vector to contain exactly three finite numbers

## Interpolation and matrices

- `CapturePreviousState()` copies current position and scale and converts the Euler rotation to a quaternion
- `SnapInterpolationToCurrentState()` performs the same capture for a snap with no visual transition
- `GetInterpolatedState(alpha)` requires a finite alpha from `0` to `1`; if no prior state exists, it first captures the current state
- Position and scale use linear interpolation
- Rotation uses spherical quaternion interpolation and follows the shorter orientation path
- `GetInterpolatedState(alpha)` returns rotation in `rotationQuaternion` as `[x, y, z, w]`
- `GetInterpolatedModelMatrix(alpha)` builds a local matrix from the interpolated state
- `GetModelMatrix()` builds a local matrix from the current state without interpolation
- `UpdateWorldMatrix(null, alpha)` writes the local matrix to `WorldMatrix`; with a parent matrix, it writes `parent × local`

## Fixed-update snapshots and runtime values

- In the current application setup, `TransformSnapshotSystem` runs before `AngularVelocitySystem` and `CameraControlSystem`
- After teleporting a transform, call `SnapInterpolationToCurrentState()` so rendering does not interpolate from its previous position or rotation
- The `position`, `rotation`, and `scale` arrays are mutable and are not validated during runtime updates; scene serialization checks that each contains three finite numbers

## Matrix convention

- Matrices are `Float32Array` values with 16 elements
- The matrix helpers write column-major matrices for the WGSL shader
- Euler-to-quaternion conversion uses Z, then Y, then X rotation order
- Quaternions use `[x, y, z, w]` order
- `MultiplyMatrix4(out, left, right)` rejects an output buffer that aliases either input

## Current scope

- Transform values are local to the entity; parent composition belongs to the hierarchy system
- Simulation and scene data use Euler angles; rendered interpolation uses quaternions
- Scale can be zero, but a zero scale on a camera can make its world matrix non-invertible

## Source

- `src/components/transform.js`
- `src/math/matrix4.js`
- `src/systems/transform-snapshot-system.js`
- `src/systems/transform-hierarchy-system.js`
- `src/components/register-scene-components.js`
