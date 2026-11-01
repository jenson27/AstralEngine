import assert from "node:assert/strict";
import test from "node:test";
import { CommandBuffer } from "../src/core/ecs/command-buffer.js";
import { EntityManager } from "../src/core/ecs/entity-manager.js";

class Position {
    constructor(x = 0) {
        this.x = x;
    }
}

class Velocity {
    constructor(x = 0) {
        this.x = x;
    }
}

test("creates entities and stores components by type", () => {
    const entityManager = new EntityManager();
    const firstEntity = entityManager.CreateEntity();
    const secondEntity = entityManager.CreateEntity();
    const position = new Position(4);

    entityManager.AddComponent(firstEntity, Position, position);

    assert.notEqual(firstEntity, secondEntity);
    assert.equal(entityManager.GetComponent(firstEntity, Position), position);
    assert.equal(entityManager.HasComponent(firstEntity, Position), true);
    assert.equal(entityManager.GetComponent(firstEntity, Velocity), undefined);
    assert.equal(entityManager.HasComponent(firstEntity, Velocity), false);
    assert.throws(
        () => entityManager.AddComponent(firstEntity, Position, new Position()),
        /already has this component/,
    );
});

test("uses UUIDs for generated and explicit entity IDs", () => {
    const entityManager = new EntityManager();
    const generatedEntity = entityManager.CreateEntity();
    const explicitEntity = "00000000-0000-4000-8000-000000000001";

    assert.match(
        generatedEntity,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    assert.equal(entityManager.CreateEntity(explicitEntity), explicitEntity);
    assert.throws(() => entityManager.CreateEntity(1), /lowercase UUID/);
    assert.throws(
        () => entityManager.CreateEntity(explicitEntity),
        /already exists/,
    );
});

test("queries component intersections and keeps packed storage valid after removal", () => {
    const entityManager = new EntityManager();
    const firstEntity = entityManager.CreateEntity();
    const secondEntity = entityManager.CreateEntity();
    const thirdEntity = entityManager.CreateEntity();

    entityManager.AddComponent(firstEntity, Position, new Position(1));
    entityManager.AddComponent(firstEntity, Velocity, new Velocity(1));
    entityManager.AddComponent(secondEntity, Position, new Position(2));
    entityManager.AddComponent(thirdEntity, Position, new Position(3));
    entityManager.AddComponent(thirdEntity, Velocity, new Velocity(3));

    assert.deepEqual(
        [...entityManager.Query(Position, Velocity)].sort(),
        [firstEntity, thirdEntity].sort(),
    );

    entityManager.RemoveComponent(firstEntity, Position);

    assert.deepEqual(
        [...entityManager.Query(Position, Velocity)],
        [thirdEntity],
    );
    assert.deepEqual([...entityManager.Query(Position, class Missing {})], []);
    assert.throws(() => [...entityManager.Query()], /at least one component/);
});

test("destroys entities, compacts component storage, and dispatches removals", () => {
    const entityManager = new EntityManager();
    const destroyedEntity = entityManager.CreateEntity();
    const survivingEntity = entityManager.CreateEntity();
    const destroyedPosition = new Position(1);
    const destroyedVelocity = new Velocity(1);
    const survivingPosition = new Position(2);
    const survivingVelocity = new Velocity(2);
    const removals = [];

    entityManager.RegisterComponentRemovalHandler(
        Position,
        (removal) => removals.push(removal),
    );
    entityManager.RegisterComponentRemovalHandler(
        Velocity,
        (removal) => removals.push(removal),
    );

    entityManager.AddComponent(destroyedEntity, Position, destroyedPosition);
    entityManager.AddComponent(destroyedEntity, Velocity, destroyedVelocity);
    entityManager.AddComponent(survivingEntity, Position, survivingPosition);
    entityManager.AddComponent(survivingEntity, Velocity, survivingVelocity);

    entityManager.DestroyEntity(destroyedEntity);

    assert.deepEqual([...entityManager.Query(Position)], [survivingEntity]);
    assert.deepEqual([...entityManager.Query(Velocity)], [survivingEntity]);
    assert.strictEqual(
        entityManager.GetComponent(survivingEntity, Position),
        survivingPosition,
    );
    assert.strictEqual(
        entityManager.GetComponent(survivingEntity, Velocity),
        survivingVelocity,
    );
    assert.deepEqual(removals, []);

    entityManager.DispatchComponentRemovals();

    assert.equal(removals.length, 2);
    assert.ok(
        removals.some(
            (removal) =>
                removal.entityId === destroyedEntity &&
                removal.componentType === Position &&
                removal.component === destroyedPosition,
        ),
    );
    assert.ok(
        removals.some(
            (removal) =>
                removal.entityId === destroyedEntity &&
                removal.componentType === Velocity &&
                removal.component === destroyedVelocity,
        ),
    );
    assert.throws(
        () => entityManager.GetComponent(destroyedEntity, Position),
        /does not exist/,
    );
});

test("blocks component membership changes while a query is active", () => {
    const entityManager = new EntityManager();
    const entity = entityManager.CreateEntity();
    entityManager.AddComponent(entity, Position, new Position());

    const query = entityManager.Query(Position);
    assert.deepEqual(query.next(), { value: entity, done: false });

    assert.throws(
        () => entityManager.AddComponent(entity, Velocity, new Velocity()),
        /active query/,
    );
    assert.throws(
        () => entityManager.RemoveComponent(entity, Position),
        /active query/,
    );
    assert.throws(
        () => entityManager.DestroyEntity(entity),
        /active query/,
    );

    query.return();

    entityManager.AddComponent(entity, Velocity, new Velocity());
    assert.equal(entityManager.HasComponent(entity, Velocity), true);
});

test("command buffer applies queued additions, removals, and destruction", () => {
    const entityManager = new EntityManager();
    const componentEntity = entityManager.CreateEntity();
    const addedEntity = entityManager.CreateEntity();
    const destroyedEntity = entityManager.CreateEntity();
    const commandBuffer = new CommandBuffer();

    entityManager.AddComponent(componentEntity, Position, new Position());

    commandBuffer.RemoveComponent(componentEntity, Position);
    commandBuffer.AddComponent(addedEntity, Velocity, new Velocity(5));
    assert.equal(commandBuffer.DestroyEntity(destroyedEntity), true);
    assert.equal(commandBuffer.DestroyEntity(destroyedEntity), false);

    assert.throws(
        () =>
            commandBuffer.AddComponent(
                destroyedEntity,
                Position,
                new Position(),
            ),
        /queued for destruction/,
    );

    commandBuffer.Flush(entityManager);

    assert.equal(entityManager.HasComponent(componentEntity, Position), false);
    assert.equal(entityManager.GetComponent(addedEntity, Velocity).x, 5);
    assert.throws(
        () => entityManager.GetComponent(destroyedEntity, Position),
        /does not exist/,
    );
});

test("dispatches component removal handlers after removal", () => {
    const entityManager = new EntityManager();
    const entity = entityManager.CreateEntity();
    const position = new Position(7);
    const removals = [];

    const removeHandler = entityManager.RegisterComponentRemovalHandler(
        Position,
        (removal) => removals.push(removal),
    );

    entityManager.AddComponent(entity, Position, position);
    assert.equal(entityManager.RemoveComponent(entity, Position), true);
    assert.deepEqual(removals, []);

    entityManager.DispatchComponentRemovals();

    assert.equal(removals.length, 1);
    assert.equal(removals[0].entityId, entity);
    assert.equal(removals[0].componentType, Position);
    assert.equal(removals[0].component, position);

    removeHandler();
    entityManager.AddComponent(entity, Position, new Position(8));
    entityManager.RemoveComponent(entity, Position);
    entityManager.DispatchComponentRemovals();

    assert.equal(removals.length, 1);
});

test("runs remaining removal handlers when one handler throws", () => {
    const entityManager = new EntityManager();
    const entity = entityManager.CreateEntity();
    let secondHandlerCalled = false;

    entityManager.RegisterComponentRemovalHandler(Position, () => {
        throw new Error("Handler failed.");
    });
    entityManager.RegisterComponentRemovalHandler(Position, () => {
        secondHandlerCalled = true;
    });

    entityManager.AddComponent(entity, Position, new Position());
    entityManager.RemoveComponent(entity, Position);

    assert.throws(
        () => entityManager.DispatchComponentRemovals(),
        AggregateError,
    );
    assert.equal(secondHandlerCalled, true);
});
