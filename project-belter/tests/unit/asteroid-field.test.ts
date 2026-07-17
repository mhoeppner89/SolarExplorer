import { describe, expect, it } from 'vitest';
import { tuning } from '../../src/game/config/tuning';
import { GameSimulation } from '../../src/game/simulation/GameSimulation';
import { distance } from '../../src/game/simulation/Vector2';

describe('seeded asteroid field', () => {
  it('is reproducible and keeps the launch perimeter clear', () => {
    const first = new GameSimulation(undefined, 84_221);
    const second = new GameSimulation(undefined, 84_221);

    expect([...second.entities.asteroids.values()]).toEqual([...first.entities.asteroids.values()]);
    expect(first.entities.asteroids.size).toBe(tuning.asteroid.count);

    for (const asteroid of first.entities.asteroids.values()) {
      const playerSurfaceGap = distance(
        asteroid.transform.position,
        first.ship.transform.position,
      ) - asteroid.radius - first.ship.collider.radius;

      for (const station of first.entities.stations.values()) {
        const stationSurfaceGap = distance(
          asteroid.transform.position,
          station.transform.position,
        ) - asteroid.radius - station.collider.radius;
        expect(stationSurfaceGap).toBeGreaterThanOrEqual(
          tuning.station.asteroidExclusionPadding - 0.000_001,
        );
      }
      expect(playerSurfaceGap).toBeGreaterThanOrEqual(
        tuning.asteroid.playerSpawnExclusionPadding - 0.000_001,
      );
    }

    const asteroids = [...first.entities.asteroids.values()];
    for (let firstIndex = 0; firstIndex < asteroids.length; firstIndex += 1) {
      const firstAsteroid = asteroids[firstIndex];
      if (firstAsteroid === undefined) {
        continue;
      }
      for (let secondIndex = firstIndex + 1; secondIndex < asteroids.length; secondIndex += 1) {
        const secondAsteroid = asteroids[secondIndex];
        if (secondAsteroid === undefined) {
          continue;
        }
        expect(distance(firstAsteroid.transform.position, secondAsteroid.transform.position))
          .toBeGreaterThanOrEqual(firstAsteroid.radius + secondAsteroid.radius - 0.000_001);
      }
    }
  });

  it('contains explicit 1x, 2x, 5x, 10x, and 25x asteroid size classes', () => {
    const simulation = new GameSimulation();
    const bySeed = new Map(
      [...simulation.entities.asteroids.values()].map((asteroid) => [asteroid.seed, asteroid]),
    );
    const verySmall = bySeed.get(1002);
    const small = bySeed.get(1001);
    const medium = bySeed.get(1003);
    const large = bySeed.get(1004);
    const veryLarge = bySeed.get(1005);

    expect(verySmall?.sizeClass).toBe('very-small');
    expect(small?.sizeClass).toBe('small');
    expect(medium?.sizeClass).toBe('medium');
    expect(large?.sizeClass).toBe('large');
    expect(veryLarge?.sizeClass).toBe('very-large');
    expect(small?.radius).toBeCloseTo((verySmall?.radius ?? 0) * 2, 6);
    expect(medium?.radius).toBeCloseTo((verySmall?.radius ?? 0) * 5, 6);
    expect(large?.radius).toBeCloseTo((verySmall?.radius ?? 0) * 10, 6);
    expect(veryLarge?.radius).toBeCloseTo((verySmall?.radius ?? 0) * 25, 6);

    const classes = new Set(
      [...simulation.entities.asteroids.values()].map((asteroid) => asteroid.sizeClass),
    );
    expect(classes).toEqual(new Set(['very-small', 'small', 'medium', 'large', 'very-large']));
  });

  it('doubles the station footprint while keeping the launch lane clear', () => {
    const simulation = new GameSimulation();

    expect(simulation.station.collider.radius).toBe(110);
    expect(simulation.ship.transform.position).toEqual({
      x: simulation.station.transform.position.x,
      y: simulation.station.transform.position.y - 120,
    });
  });

  it('forms a diagonal belt with barren rock dominant and richer violent corners', () => {
    const simulation = new GameSimulation(undefined, 84_221);
    const asteroids = [...simulation.entities.asteroids.values()];
    const barren = asteroids.filter((asteroid) => asteroid.resourceType === 'none');
    const centre = asteroids.filter((asteroid) =>
      Math.abs((asteroid.transform.position.x - asteroid.transform.position.y) / 2) < 900);
    const corners = asteroids.filter((asteroid) =>
      Math.abs((asteroid.transform.position.x - asteroid.transform.position.y) / 2) > 900);
    const resourceRank = { none: 0, water: 1, industrial: 1, rare: 3 };
    const average = (values: number[]): number =>
      values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);

    expect(barren.length).toBeGreaterThan(asteroids.length / 2);
    expect(centre.length).toBeLessThan(corners.length);
    expect(average(corners.map((asteroid) => asteroid.radius)))
      .toBeGreaterThan(average(centre.map((asteroid) => asteroid.radius)));
    expect(average(corners.map((asteroid) => Math.hypot(
      asteroid.velocity.linear.x,
      asteroid.velocity.linear.y,
    )))).toBeGreaterThan(average(centre.map((asteroid) => Math.hypot(
      asteroid.velocity.linear.x,
      asteroid.velocity.linear.y,
    ))));
    expect(average(centre.map((asteroid) => Math.hypot(
      asteroid.velocity.linear.x,
      asteroid.velocity.linear.y,
    )))).toBeLessThan(1.5);
    expect(average(corners.map((asteroid) => Math.hypot(
      asteroid.velocity.linear.x,
      asteroid.velocity.linear.y,
    )))).toBeLessThan(3.5);
    expect(average(corners.map((asteroid) => resourceRank[asteroid.resourceType])))
      .toBeGreaterThanOrEqual(average(centre.map((asteroid) => resourceRank[asteroid.resourceType])));
  });

  it('does not arm mining drones on barren rock', () => {
    const simulation = new GameSimulation();
    simulation.launch();
    const barren = [...simulation.entities.asteroids.values()].find(
      (asteroid) => asteroid.resourceType === 'none',
    );
    expect(barren).toBeDefined();
    if (barren === undefined) {
      return;
    }
    simulation.selectAsteroid(barren.id);
    simulation.debugTeleportNearTarget(28);
    for (let index = 0; index < tuning.simulationHz * 2; index += 1) {
      simulation.step(1 / tuning.simulationHz);
    }

    expect(simulation.entities.drones.size).toBe(0);
    expect(simulation.getDebugSnapshot().mining.status).toBe('not-ready');
  });

  it('assigns shape and resource tiers independently from radius', () => {
    const simulation = new GameSimulation(undefined, 84_221);
    simulation.clearAsteroids();
    const trace = simulation.spawnAsteroid({
      position: { x: 700, y: 0 },
      velocity: { x: 0, y: 0 },
      radius: 20,
      seed: 31,
      spriteIndex: 1,
      resourceTier: 'trace',
    });
    const exceptional = simulation.spawnAsteroid({
      position: { x: 900, y: 0 },
      velocity: { x: 0, y: 0 },
      radius: 20,
      seed: 32,
      spriteIndex: 3,
      resourceTier: 'exceptional',
    });

    expect(trace.shapeClass).toBe('shard');
    expect(exceptional.shapeClass).toBe('wedge');
    expect(trace.radius).toBe(exceptional.radius);
    expect(exceptional.maximumYield).toBeGreaterThan(trace.maximumYield * 3);
  });
});
