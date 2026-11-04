# Angular Velocity

## Purpose

`AngularVelocity` stores rotation rates around the X, Y, and Z axes. `AngularVelocitySystem` applies those rates to entities that also have `Transform`. It does not calculate forces or physics. See [Transform](TRANSFORM_README.md) for rotation storage and interpolation.

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `AngularVelocity` | Stores finite angular rates for three axes |
| `AngularVelocitySystem.FixedUpdate(scene, context)` | Adds each rate multiplied by the fixed delta time to the entity's rotation |

## Angular velocity data

- `x`, `y`, and `z` are radians per second around the corresponding local rotation axes
- `AngularVelocity(x = 0, y = 0, z = 0)` rejects non-finite values
- Values remain mutable after construction; serialization checks that they are still finite

## Behaviour

- The system queries entities with both `Transform` and `AngularVelocity`
- It adds `rate × deltaTime` to each Euler rotation component
- An entity without either component is skipped
- Updates use the fixed delta time supplied by the scene scheduler

## Current scope

- Rotation uses Euler angles
- There is no physics integration, damping, or angular acceleration

## Source

- `src/components/angular-velocity.js`
- `src/systems/angular-velocity-system.js`
- `src/components/register-scene-components.js`
