import { describe, expect, it } from 'vitest';
import { neutralFlightActions } from '../../src/game/input/InputActions';
import { GameSimulation } from '../../src/game/simulation/GameSimulation';
import { length, subtract } from '../../src/game/simulation/Vector2';

const dt = 1 / 60;

const advance = (simulation: GameSimulation, seconds: number): void => {
  for (let index = 0; index < Math.ceil(seconds / dt); index += 1) {
    simulation.step(dt, neutralFlightActions());
  }
};

describe('mining drone loop', () => {
  it('allows drones to stabilize and launch below 5 m/s relative speed', () => {
    const simulation = new GameSimulation();
    simulation.launch();
    const targetId = simulation.tutorialAsteroidId ?? -1;
    simulation.selectAsteroid(targetId);
    simulation.debugTeleportNearTarget(27);
    const target = simulation.entities.asteroids.get(targetId);
    expect(target).toBeDefined();
    if (target === undefined) {
      return;
    }
    simulation.ship.velocity.linear = {
      x: target.velocity.linear.x + 4.2,
      y: target.velocity.linear.y,
    };

    advance(simulation, 1.4);

    expect(simulation.entities.drones.size).toBeGreaterThan(0);
  });

  it('launches only after stabilization and credits cargo only after return', () => {
    const simulation = new GameSimulation();
    simulation.launch();
    const targetId = simulation.tutorialAsteroidId;
    expect(targetId).not.toBeNull();
    expect(simulation.selectAsteroid(targetId ?? -1)).toBe(true);
    simulation.debugTeleportNearTarget(28);

    advance(simulation, 0.45);
    expect(simulation.entities.drones.size).toBe(0);
    expect(simulation.ship.cargoMass).toBe(0);

    advance(simulation, 0.3);
    expect(simulation.entities.drones.size).toBeGreaterThan(0);
    expect(simulation.ship.cargoMass).toBe(0);

    advance(simulation, 1.2);
    expect(simulation.ship.cargoMass).toBe(0);

    advance(simulation, 4.2);
    expect(simulation.ship.cargoMass).toBeGreaterThanOrEqual(3);
    const cargoEvents = simulation.drainEvents().filter((event) => event.type === 'CargoDelivered');
    expect(cargoEvents.length).toBeGreaterThan(0);
  });

  it('pauses extraction on mild drift and recalls on dangerous drift', () => {
    const simulation = new GameSimulation();
    simulation.launch();
    simulation.selectAsteroid(simulation.tutorialAsteroidId ?? -1);
    simulation.debugTeleportNearTarget(28);
    advance(simulation, 1.5);
    expect(simulation.entities.drones.size).toBeGreaterThan(0);

    const target = simulation.entities.asteroids.get(simulation.tutorialAsteroidId ?? -1);
    expect(target).toBeDefined();
    if (target === undefined) {
      return;
    }
    simulation.debugTeleportNearTarget(85);
    simulation.ship.velocity.linear = { ...target.velocity.linear };
    advance(simulation, 0.1);
    expect(simulation.getDebugSnapshot().mining.status).toBe('paused');

    simulation.debugTeleportNearTarget(125);
    advance(simulation, 0.1);
    expect(simulation.getDebugSnapshot().mining.status).toBe('recalling');
  });

  it('launches while the ship holds in the wider asteroid vicinity', () => {
    const simulation = new GameSimulation();
    simulation.launch();
    simulation.selectAsteroid(simulation.tutorialAsteroidId ?? -1);
    simulation.debugTeleportNearTarget(60);

    advance(simulation, 0.8);

    expect(simulation.getDebugSnapshot().mining.surfaceDistance).toBeLessThanOrEqual(70);
    expect(simulation.entities.drones.size).toBeGreaterThan(0);
  });

  it('keeps mining debris below the harmless contact threshold relative to its asteroid', () => {
    const simulation = new GameSimulation();
    simulation.launch();
    const targetId = simulation.tutorialAsteroidId ?? -1;
    simulation.selectAsteroid(targetId);
    simulation.debugTeleportNearTarget(28);
    advance(simulation, 4.3);

    const target = simulation.entities.asteroids.get(targetId);
    expect(target).toBeDefined();
    expect(simulation.entities.debris.size).toBeGreaterThan(0);
    if (target === undefined) {
      return;
    }
    for (const debris of simulation.entities.debris.values()) {
      expect(length(subtract(debris.velocity.linear, target.velocity.linear))).toBeLessThan(5);
    }
  });
});
