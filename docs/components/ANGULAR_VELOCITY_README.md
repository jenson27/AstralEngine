# Angular Velocity

## Purpose

`AngularVelocity` stores rotation rates for the X, Y, and Z axes. It is data only; `AngularVelocitySystem.Update()` uses it to change a matching entity's `Transform`. See [Transform](TRANSFORM_README.md) for the rotation values that the system updates.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `AngularVelocity` | Stores angular rates for three axes. |
| `constructor()` | Validates and stores the initial X, Y, and Z rates. |
| `AngularVelocitySystem.Update()` | Adds each rate multiplied by delta time to a matching transform's rotation. |

## Angular velocity data

- `x` - Rotation rate around the X axis, in radians per second. Defaults to `0`.
- `y` - Rotation rate around the Y axis, in radians per second. Defaults to `0`.
- `z` - Rotation rate around the Z axis, in radians per second. Defaults to `0`.

## Behaviour

- The constructor throws a `TypeError` if any initial rate is not finite.
- The rate fields are public and can be changed after construction. Later changes are not validated by this component.
- `AngularVelocitySystem.Update()` processes entities that have both `Transform` and `AngularVelocity`.
- Each rotation value is updated by `rate * deltaTime`.
- Entities without either required component are not processed.

## Current scope

- The component does not validate values assigned after construction.
- The component does not rotate an entity by itself; a system must update it.

## Source

- `src/components/angular-velocity.js`
- `src/systems/angular-velocity-system.js`
