# Serialization

## Purpose

The serialization layer converts registered JavaScript objects to versioned records and validates JSON-compatible values. `ComponentRegistry` applies those codecs to ECS components, and `EcsDocumentAdapter` creates a scene document from a live scene. It does not write files or fetch scene data; `SceneLoader` handles loading. See [Scene Management](../core/SCENE_MANAGEMENT_README.md).

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `TypeSerializerRegistry` | Registers runtime types, serializes records, and runs version migrations |
| `ComponentRegistry` | Restricts the type registry to registered scene components |
| `SerializationContext` | Provides named services to serializers and deserializers |
| `EcsDocumentAdapter` | Serializes a live scene into a version 1 scene object |
| `JsonFormat` | Parses JSON and encodes only values that JSON can represent without loss |
| `CreateSceneComponentRegistry()` | Registers the engine's built-in scene component codecs |

## Ownership

- A `ComponentRegistry` owns a `TypeSerializerRegistry` unless one is provided
- Registries retain factory and codec function references; they do not own serialized data or component instances
- Serialization contexts copy service entries into a map and retain the service values by reference
- `EcsDocumentAdapter` retains the component registry supplied to its constructor

## Versioned type records

- A serialized record has `{ typeId, version, data }`
- `typeId` and runtime class registrations must be unique
- `version` must be a positive integer
- The serializer calls `Serialize(value, context)` and stores its result in `data`
- Deserialization rejects unknown IDs, missing data, invalid versions, and records newer than the registered version
- When the record is older, `Migrate(data, fromVersion, context)` runs once per version step
- Missing migration functions or a migration that returns `undefined` cause deserialization to throw
- The deserializer must return an instance of the registered runtime class

## Type and component registry APIs

| Member | Behaviour |
| --- | --- |
| `TypeSerializerRegistry.Register(typeId, runtimeType, options)` | Registers `Version`, `Serialize`, `Deserialize`, and optional `Migrate` functions |
| `GetRuntimeType(typeId)` | Returns the registered class or throws for an unknown ID |
| `Serialize(value, context)` / `Deserialize(record, context)` | Converts between runtime instances and versioned records |
| `ComponentRegistry.Register(typeId, componentType, factory, options)` | Registers a component factory and codec version |
| `CreateComponent(typeId, data, services)` | Deserializes data at the component's current version and returns `{ componentType, component }` |
| `DeserializeComponent(record, context)` | Deserializes a component record and returns its runtime class and instance |
| `SerializeComponent(component, context)` | Serializes a registered component; non-component registered types are rejected |

## Services

| Member | Behaviour |
| --- | --- |
| `SerializationContext.From(value)` | Returns an existing context or wraps a plain service object |
| `GetService(serviceId)` | Returns the service or `undefined` |
| `RequireService(serviceId)` | Returns the service or throws if it is missing or null |

- The built-in `meshRenderer` codec requires `ResolveMeshHandle` and `ResolveMaterialHandle` services
- These services resolve scene asset IDs to handles already acquired by the scene asset scope
- Callers may pass a `SerializationContext` or a plain object of services

## Scene document

- The document has `format: "astral-scene"`, `version: 1`, `name`, `activeCameraEntityId`, `assets`, and `entities`
- Each entity record has `name`, `id`, and typed `components`
- The adapter requires a valid active camera ID that exists and has both `Camera` and `Transform`
- Component records preserve each registered component's `typeId`, `version`, and `data`
- The adapter collects mesh and material asset IDs from `meshRenderer` records, removes duplicates, and sorts the resulting `assets` list
- Parent relationships serialize through the `parent` component's `parentEntityId`
- `SceneLoader` validates the document's format, component records, camera, asset references, and parent graph when loading

## Built-in component records

`CreateSceneComponentRegistry()` registers these version 1 component IDs:

- `transform` - Three finite position, rotation, and scale values
- `parent` - A parent entity UUID
- `angularVelocity` - Finite `x`, `y`, and `z` rates
- `camera` - Perspective field of view and clipping planes
- `cameraController` - Movement and look settings
- `meshRenderer` - Mesh asset ID and material asset IDs keyed by slot

- Vectors must contain exactly three finite numbers
- Camera and controller settings are validated on both serialization and deserialization
- `meshRenderer` serialization requires non-empty asset IDs on its handles

## JSON format rules

| Member | Behaviour |
| --- | --- |
| `JsonFormat.Parse(text)` | Requires a string and wraps invalid JSON in a `SyntaxError` with its cause |
| `JsonFormat.Stringify(value, space = 2)` | Validates JSON compatibility, then encodes the value; failures become a `TypeError` with a cause |

- Accepted values are `null`, strings, booleans, finite numbers other than negative zero, arrays, and plain objects
- Circular references, sparse arrays, symbols, accessors, non-enumerable object fields, non-index array fields, and non-plain objects are rejected
- `undefined`, functions, `BigInt`, and other unsupported primitive values are rejected
- Parsing follows `JSON.parse()` behavior after the string type check

## Current scope

- Scene documents and built-in component records use version `1`
- `EcsDocumentAdapter` serializes a scene but does not write it to storage
- Migrations are registered per type; no global scene-document migration is provided

## Source

- `src/serialization/type-serializer-registry.js`
- `src/serialization/serialization-context.js`
- `src/serialization/json-format.js`
- `src/serialization/adapters/ecs-document-adapter.js`
- `src/core/ecs/component-registry.js`
- `src/components/register-scene-components.js`
- `src/core/scene-loader.js`
