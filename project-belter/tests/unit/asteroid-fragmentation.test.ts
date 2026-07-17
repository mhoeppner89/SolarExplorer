import { describe, expect, it } from 'vitest';
import { neutralFlightActions } from '../../src/game/input/InputActions';
import { GameSimulation } from '../../src/game/simulation/GameSimulation';

describe('asteroid collisions and fragmentation', () => {
  it('splits a fragile asteroid into resource-preserving fragments of the same type', () => {
    const simulation = new GameSimulation();
    simulation.clearAsteroids();
    simulation.launch();
    const fragile = simulation.spawnAsteroid({
      position: { x: 900, y: 0 },
      velocity: { x: 12, y: 0 },
      radius: 60,
      seed: 4_401,
      spriteIndex: 2,
      name: 'C-44 Split Decision',
      materialClass: 'carbonaceous',
      resourceType: 'rare',
      resourceTier: 'rich',
      remainingYield: 40,
      stability: 0.1,
    });
    simulation.spawnAsteroid({
      position: { x: 935, y: 0 },
      velocity: { x: -12, y: 0 },
      radius: 20,
      seed: 4_402,
      spriteIndex: 0,
      materialClass: 'metallic',
      resourceType: 'industrial',
      resourceTier: 'standard',
      remainingYield: 20,
      stability: 0.95,
    });
    simulation.selectAsteroid(fragile.id);

    simulation.step(1 / 60, neutralFlightActions());
    const fracture = simulation.drainEvents().find((event) => event.type === 'AsteroidFractured');

    expect(fracture?.type).toBe('AsteroidFractured');
    if (fracture?.type !== 'AsteroidFractured') {
      return;
    }
    expect(fracture.asteroidId).toBe(fragile.id);
    expect(fracture.cause).toBe('asteroid');
    expect(fracture.fragmentIds.length).toBeGreaterThanOrEqual(2);
    expect(simulation.entities.asteroids.has(fragile.id)).toBe(false);
    const fragments = fracture.fragmentIds.map((id) => simulation.entities.asteroids.get(id));
    expect(fragments.every((fragment) => fragment?.materialClass === 'carbonaceous')).toBe(true);
    expect(fragments.every((fragment) => fragment?.resourceType === 'rare')).toBe(true);
    expect(fragments.every((fragment) => fragment?.resourceTier === 'rich')).toBe(true);
    expect(fragments.every((fragment) => fragment?.fragmentGeneration === 1)).toBe(true);
    expect(fragments.every((fragment) => (fragment?.radius ?? 60) < fragile.radius)).toBe(true);
    expect(fragments.reduce((total, fragment) => total + (fragment?.remainingYield ?? 0), 0))
      .toBeCloseTo(40 * simulation.config.asteroid.fragmentationResourceRetention, 5);
    expect(fracture.fragmentIds).toContain(simulation.selectedTarget?.id);
  });

  it('does not split asteroids in a low-speed contact', () => {
    const simulation = new GameSimulation();
    simulation.clearAsteroids();
    simulation.launch();
    const first = simulation.spawnAsteroid({
      position: { x: 900, y: 0 },
      velocity: { x: 2, y: 0 },
      radius: 20,
      seed: 8_101,
      stability: 0.1,
    });
    const second = simulation.spawnAsteroid({
      position: { x: 935, y: 0 },
      velocity: { x: -2, y: 0 },
      radius: 20,
      seed: 8_102,
      stability: 0.1,
    });

    simulation.step(1 / 60, neutralFlightActions());
    const fracture = simulation.drainEvents().find((event) => event.type === 'AsteroidFractured');

    expect(fracture).toBeUndefined();
    expect(simulation.entities.asteroids.has(first.id)).toBe(true);
    expect(simulation.entities.asteroids.has(second.id)).toBe(true);
  });

  it('gives very-large asteroids enough structure to survive a severe first impact', () => {
    const simulation = new GameSimulation();
    simulation.clearAsteroids();
    simulation.launch();
    simulation.ship.transform.position = { x: 0, y: 0 };
    simulation.ship.transform.previousPosition = { x: 0, y: 0 };
    simulation.ship.velocity.linear = { x: 80, y: 0 };
    const massif = simulation.spawnAsteroid({
      position: { x: 260, y: 0 },
      velocity: { x: 0, y: 0 },
      radius: 300,
      sizeClass: 'very-large',
      materialClass: 'rocky',
      resourceType: 'none',
      stability: 0.3,
    });
    const startingIntegrity = massif.structuralIntegrity;

    simulation.step(1 / 60, neutralFlightActions());

    expect(massif.maximumStructuralIntegrity).toBeGreaterThanOrEqual(80);
    expect(massif.structuralIntegrity).toBeLessThan(startingIntegrity);
    expect(massif.structuralIntegrity).toBeGreaterThan(0);
    expect(simulation.entities.asteroids.has(massif.id)).toBe(true);
    expect(simulation.drainEvents().find((event) => event.type === 'AsteroidFractured')).toBeUndefined();
  });

  it('keeps a busy field below the fragmentation cap during sustained simulation', () => {
    const simulation = new GameSimulation(undefined, 84_221);
    simulation.launch();
    for (let step = 0; step < 60 * simulation.config.simulationHz; step += 1) {
      simulation.step(1 / simulation.config.simulationHz, neutralFlightActions());
      simulation.drainEvents();
    }

    expect(simulation.entities.asteroids.size)
      .toBeLessThanOrEqual(simulation.config.asteroid.fragmentationMaxAsteroids);
    expect(simulation.entities.asteroids.size).toBeLessThan(52);
  });
});
