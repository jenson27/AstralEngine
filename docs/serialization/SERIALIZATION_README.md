# Serialization

## Purpose

The serialization system converts registered runtime types and scene ECS data to versioned JSON-compatible records, then rebuilds objects from those records. It controls type lookup, data migration, and serialization services, but it does not save files or fetch scenes. `SceneLoader` handles fetching and scene construction; see [Scene Management](../core/SCENE_MANAGEMENT_README.md).

## Main parts and responsibilities

| Part | Responsibility |
| --- | --- |
| `JsonFormat.Parse()` | Parses a JSON string and wraps syntax errors. |
| `JsonFormat.Stringify()` | Validates JSON-compatible values and returns formatted JSON text. |
| `SerializationContext.constructor()` | Copies service entries into a lookup map. |
| `SerializationContext.From()` | Reuses a context or creates one from a services object. |
| `SerializationContext.GetService()` / `RequireService()` | Reads an optional service or throws if it is missing. |
| `TypeSerializerRegistry.Register()` | Registers a runtime type and its serializer functions. |
| `TypeSerializerRegistry.constructor()` | Creates empty maps for registered IDs and runtime classes. |
| `TypeSerializerRegistry.GetRuntimeType()` | Returns the runtime class for a type ID. |
| `TypeSerializerRegistry.Serialize()` / `Deserialize()` | Converts a registered object to or from a versioned record. |
| `ComponentRegistry.Register()` | Registers one component class and its factory and codec. |
| `ComponentRegistry.constructor()` | Validates and stores the type serializer registry. |
| `ComponentRegistry.CreateComponent()` | Creates a component using the current data version and returns its type and instance. |
| `ComponentRegistry.DeserializeComponent()` | Deserializes a component record and returns its type and instance. |
| `ComponentRegistry.SerializeComponent()` | Serializes a registered component and checks that its type is a component. |
| `ComponentRegistry.Serializers` | Exposes the underlying type serializer registry. |
| `EcsDocumentAdapter.Serialize()` | Converts a scene's entities and components to an `astral-scene` document. |
| `EcsDocumentAdapter.constructor()` | Validates and stores the component registry. |
| `CreateSceneComponentRegistry()` | Creates the component registry for built-in scene component types. |

## Ownership

- `TypeSerializerRegistry` owns maps keyed by type ID and runtime class. It has no unregister operation.
- `ComponentRegistry` stores its type serializer registry and component-version map.
- `SerializationContext` copies the service entries into a `Map`, but keeps each service value by reference.
- `EcsDocumentAdapter` stores the component registry supplied to its constructor.
- The registries do not retain runtime objects or codec results after a call.

## Type records

A serialized type record has this shape:

```json
{
  "typeId": "example",
  "version": 1,
  "data": {}
}
```

- `typeId` is a stable string chosen at registration.
- `version` is a positive safe integer set by the registration.
- `data` is produced or consumed by the registered codec functions.
- The registry uses the exact `value.constructor` as the runtime type key. It does not look up a parent class.

## Type registration and migration

- `Register()` requires a non-empty type ID, a runtime class, a positive version, and `Serialize` and `Deserialize` functions.
- `Migrate` is optional. Duplicate type IDs and duplicate runtime classes throw an error.
- `Serialize()` rejects non-object values, unregistered runtime classes, and serializer results of `undefined`.
- `Deserialize()` rejects invalid records, unknown type IDs, invalid versions, missing data, and versions newer than the registration.
- Older records are migrated one version at a time. Deserialization fails if a migration step is missing or returns `undefined`.
- The deserializer must return an instance of the registered runtime class.

## Component codecs and services

- `ComponentRegistry.Register()` associates a component ID and class with a factory, current version, serializer, and optional migration function.
- `CreateComponent()` assumes data is already in the current registered version. `DeserializeComponent()` uses the record version and applies migrations when needed.
- `CreateComponent()` and `DeserializeComponent()` return `{ componentType, component }`.
- `SerializeComponent()` rejects types that exist in the underlying type registry but were not registered as components.
- `SerializationContext` accepts a plain object of service IDs and values, or an existing context instance.
- `RequireService()` throws when a service is missing or `null`. `GetService()` returns `undefined` for a missing service.

## Scene document

`EcsDocumentAdapter.Serialize()` produces a version 1 scene document:

```json
{
  "format": "astral-scene",
  "version": 1,
  "name": "level-name",
  "activeCameraEntityId": "6475b38a-9cc8-43c6-93f5-28017a3d2cf1",
  "entities": [
    {
      "name": "Main Camera",
      "id": "6475b38a-9cc8-43c6-93f5-28017a3d2cf1",
      "components": [
        {
          "typeId": "transform",
          "version": 1,
          "data": {
            "position": [0, 0, 3],
            "rotation": [0, 0, 0],
            "scale": [1, 1, 1]
          }
        },
        {
          "typeId": "camera",
          "version": 1,
          "data": {
            "fieldOfView": 1.0471975511965976,
            "nearPlane": 0.1,
            "farPlane": 100
          }
        }
      ]
    }
  ]
}
```

- The adapter requires a scene with a name and an entity manager that can list entity IDs, entity names, and component entries.
- Version 1 entity IDs and the active camera ID are lowercase UUID strings. The active camera ID must identify an entity with both `Camera` and `Transform`.
- Each entity record contains its name, ID, and serialized components. The loader accepts an omitted name and uses `Entity` as the default. Names can repeat; UUIDs identify entities.
- The adapter does not serialize systems or arbitrary scene services.
- `SceneLoader` accepts only scene document version 1. It requires UUID entity IDs and a list of typed component records.
- Legacy scene layouts that used numeric entity IDs or component maps are not supported.
- Scene document version and individual component record versions are separate values.

## JSON format rules

- `JsonFormat.Parse()` accepts only strings. Invalid JSON raises a `SyntaxError` with the parse error as its cause.
- `JsonFormat.Stringify()` accepts null, strings, booleans, finite numbers except negative zero, arrays, and plain objects.
- It rejects circular references, sparse arrays, array properties that are not valid indexes, symbol properties, accessors, non-enumerable object properties, and non-plain objects.
- Shared object references that do not form a cycle are allowed.
- Stringify validation and encoding errors are wrapped in a `TypeError` with the original error as its cause.

## Built-in scene component registrations

`CreateSceneComponentRegistry()` registers the built-in component codecs:

- `transform` (version 1) - Stores finite three-value position, rotation, and scale arrays.
- `angularVelocity` (version 1) - Stores finite `x`, `y`, and `z` rates.
- `camera` (version 1) - Stores field of view and near and far planes after validating their ranges.
- `meshRenderer` (version 1) - Stores a mesh asset ID and material IDs by mesh slot, or one default material ID.

## Current scope

- The built-in scene registry does not register migrations for its current component formats.
- Mesh data is not embedded in scene JSON. The caller resolves mesh asset IDs through serialization services.
- `EcsDocumentAdapter` serializes the scene name, active camera, entities, and components only.

## Source

- `src/serialization/json-format.js`
- `src/serialization/serialization-context.js`
- `src/serialization/type-serializer-registry.js`
- `src/serialization/adapters/ecs-document-adapter.js`
- `src/core/ecs/component-registry.js`
- `src/components/register-scene-components.js`
- `src/core/scene-loader.js`
