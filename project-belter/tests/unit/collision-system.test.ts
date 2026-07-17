import { describe, expect, it } from 'vitest';
import { neutralFlightActions } from '../../src/game/input/InputActions';
import { GameSimulation } from '../../src/game/simulation/GameSimulation';
import { calculateCollisionDamage } from '../../src/game/simulation/systems/DamageSystem';
import { tuning } from '../../src/game/config/tuning';

const createImpact = (relativeSpeed: number): GameSimulation => {
  const simulation = new GameSimulation();
  simulation.clearAsteroids();
  simulation.launch();
  simulation.ship.transform.position = { x: 0, y: 0 };
  simulation.ship.transform.previousPosition = { x: 0, y: 0 };
  simulation.ship.velocity.linear = { x: relativeSpeed, y: 0 };
  simulation.spawnAsteroid({
    position: { x: 11.35, y: 0 },
    velocity: { x: 0, y: 0 },
    radius: 5,
    seed: 1,
    spriteIndex: 0,
  });
  simulation.step(1 / 60, neutralFlightActions());
  return simulation;
};

describe('relative-velocity collision damage', () => {
  it('uses centralized speed bands', () => {
    const safe = calculateCollisionDamage(4.9, 16, 5, 9, 15);
    const minor = calculateCollisionDamage(7, 16, 5, 9, 15);
    const serious = calculateCollisionDamage(12, 16, 5, 9, 15);
    const severe = calculateCollisionDamage(20, 16, 5, 9, 15);

    expect(safe).toEqual({ damage: 0, severity: 'safe' });
    expect(minor.severity).toBe('minor');
    expect(serious.severity).toBe('serious');
    expect(severe.severity).toBe('severe');
    expect(minor.damage).toBeLessThan(serious.damage);
    expect(serious.damage).toBeLessThan(severe.damage);
  });

  it('makes contact below 5 m/s fully inert', () => {
    const contactSpeed = tuning.safeContactSpeed - 0.1;
    const simulation = createImpact(contactSpeed);
    const collision = simulation.drainEvents().find((event) => event.type === 'CollisionOccurred');

    expect(collision).toBeUndefined();
    expect(simulation.ship.hull).toBe(100);
    expect(simulation.ship.velocity.linear.x).toBeCloseTo(contactSpeed, 5);
    expect(simulation.ship.transform.position.x).toBeCloseTo(contactSpeed / 60, 5);
  });

  it('keeps a 20 m/s impact survivable', () => {
    const simulation = createImpact(20);
    const collision = simulation.drainEvents().find((event) => event.type === 'CollisionOccurred');

    expect(collision?.type).toBe('CollisionOccurred');
    if (collision?.type === 'CollisionOccurred') {
      expect(collision.relativeSpeed).toBeGreaterThan(19.9);
      expect(collision.damage).toBeGreaterThan(5);
      expect(collision.damage).toBeLessThan(12);
      expect(collision.severity).toBe('serious');
    }
    expect(simulation.ship.hull).toBeGreaterThan(88);
    expect(simulation.ship.hull).toBeLessThan(100);
  });

  it('caps damage from a single extreme impact', () => {
    const simulation = createImpact(80);
    const collision = simulation.drainEvents().find((event) => event.type === 'CollisionOccurred');

    expect(collision?.type).toBe('CollisionOccurred');
    if (collision?.type === 'CollisionOccurred') {
      expect(collision.damage).toBeLessThanOrEqual(tuning.ship.maxCollisionDamage);
    }
    expect(simulation.ship.hull).toBeGreaterThanOrEqual(70);
  });

  it('does not collide the ship with the station', () => {
    const simulation = new GameSimulation();
    simulation.launch();
    simulation.ship.transform.position = { ...simulation.station.transform.position };
    simulation.ship.transform.previousPosition = { ...simulation.station.transform.position };
    simulation.ship.velocity.linear = { x: 20, y: 0 };

    simulation.step(1 / 60, neutralFlightActions());

    expect(simulation.ship.hull).toBe(100);
    expect(simulation.drainEvents().find((event) => event.type === 'CollisionOccurred')).toBeUndefined();
  });

  it('uses the independent ship contour for player-trader impacts', () => {
    const simulation = new GameSimulation();
    simulation.clearAsteroids();
    simulation.launch();
    const trader = [...simulation.entities.traders.values()][0];
    expect(trader).toBeDefined();
    if (trader === undefined) {
      return;
    }
    simulation.ship.transform.position = { x: 0, y: 0 };
    simulation.ship.transform.previousPosition = { x: 0, y: 0 };
    simulation.ship.velocity.linear = { x: 20, y: 0 };
    trader.transform.position = { x: 20, y: 0 };
    trader.transform.previousPosition = { x: 20, y: 0 };
    trader.state = 'docked';
    trader.dockingSecondsRemaining = 10;

    simulation.step(1 / 60, neutralFlightActions());
    const collision = simulation.drainEvents().find(
      (event) => event.type === 'CollisionOccurred' && event.objectKind === 'trader',
    );

    expect(collision?.type).toBe('CollisionOccurred');
    expect(simulation.ship.hull).toBeLessThan(100);
  });
});
