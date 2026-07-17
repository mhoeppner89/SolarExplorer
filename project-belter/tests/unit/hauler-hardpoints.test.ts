import { describe, expect, it } from 'vitest';
import { neutralFlightActions } from '../../src/game/input/InputActions';
import { getAsteroidSupportRadius } from '../../src/game/simulation/AsteroidShapeProfiles';
import { GameSimulation } from '../../src/game/simulation/GameSimulation';
import { getShipSupportRadius } from '../../src/game/simulation/ShipShapeProfile';
import { vector } from '../../src/game/simulation/Vector2';

const dt = 1 / 60;

describe('hauler hardpoints and fitted collision profile', () => {
  it('starts with one ventral mining drone and empty side hardpoints', () => {
    const snapshot = new GameSimulation().getDebugSnapshot();

    expect(snapshot.ship.hardpoints.port.moduleId).toBeNull();
    expect(snapshot.ship.hardpoints.starboard.moduleId).toBeNull();
    expect(snapshot.ship.hardpoints.ventral.moduleId).toBe('mining-drone');
    expect(snapshot.ship.maxDrones).toBe(1);
    expect(snapshot.ship.dronesAboard).toBe(1);
  });

  it('installs Wayfinder internally without consuming a universal hardpoint', () => {
    const simulation = new GameSimulation();
    simulation.applyHardpointLoadout(
      { port: 'engine-kestrel', starboard: 'retro-brace', ventral: 'cargo-saddles' },
      { port: 100, starboard: 100, ventral: 100 },
      ['flight-assist'],
    );
    simulation.launch();
    simulation.selectAsteroid(simulation.tutorialAsteroidId ?? -1);
    simulation.debugTeleportNearTarget(28);

    for (let index = 0; index < 120; index += 1) {
      simulation.step(dt, neutralFlightActions());
    }

    expect(simulation.ship.maxDrones).toBe(0);
    expect(simulation.entities.drones.size).toBe(0);
    expect(simulation.getDebugSnapshot().autopilotAvailable).toBe(true);
    expect(Object.values(simulation.ship.hardpoints).some(
      (hardpoint) => hardpoint.moduleId === 'flight-assist',
    )).toBe(false);
  });

  it('launches one drone for every operational mining-drone hardpoint', () => {
    const simulation = new GameSimulation();
    simulation.applyHardpointLoadout(
      { port: 'mining-drone', starboard: 'mining-drone', ventral: 'mining-drone' },
      { port: 100, starboard: 100, ventral: 100 },
    );
    simulation.launch();
    simulation.selectAsteroid(simulation.tutorialAsteroidId ?? -1);
    simulation.debugTeleportNearTarget(28);

    for (let index = 0; index < 60; index += 1) {
      simulation.step(dt, neutralFlightActions());
    }

    expect(simulation.ship.maxDrones).toBe(3);
    expect(simulation.entities.drones.size).toBe(3);
    expect(new Set([...simulation.entities.drones.values()].map((drone) => drone.assignedHardpoint)).size).toBe(3);
  });

  it('collides at the alpha-derived side contour instead of the old circle radius', () => {
    const simulation = new GameSimulation();
    simulation.clearAsteroids();
    simulation.launch();
    simulation.ship.transform.position = vector();
    simulation.ship.transform.previousPosition = vector();
    simulation.ship.velocity.linear = vector(20, 0);
    const asteroid = simulation.spawnAsteroid({
      position: vector(100, 0),
      velocity: vector(),
      radius: 5,
      seed: 41,
      spriteIndex: 0,
    });
    const shipEdge = getShipSupportRadius(simulation.ship, vector(1, 0));
    const asteroidEdge = getAsteroidSupportRadius(asteroid, vector(-1, 0));
    asteroid.transform.position.x = shipEdge + asteroidEdge - 0.1;
    asteroid.transform.previousPosition.x = asteroid.transform.position.x;

    simulation.step(dt, neutralFlightActions());

    expect(simulation.drainEvents().some((event) => event.type === 'CollisionOccurred')).toBe(true);
    expect(shipEdge).toBeLessThan(simulation.ship.collider.radius - 15);
  });

  it('damages exposed mounted equipment on the impacted side', () => {
    const simulation = new GameSimulation();
    simulation.applyHardpointLoadout(
      { port: null, starboard: 'engine-kestrel', ventral: 'mining-drone' },
      { port: 100, starboard: 100, ventral: 100 },
    );
    simulation.clearAsteroids();
    simulation.launch();
    simulation.ship.transform.position = vector();
    simulation.ship.transform.previousPosition = vector();
    simulation.ship.velocity.linear = vector(24, 0);
    const asteroid = simulation.spawnAsteroid({
      position: vector(100, 0),
      velocity: vector(),
      radius: 9,
      seed: 53,
      spriteIndex: 1,
    });
    const shipEdge = getShipSupportRadius(simulation.ship, vector(1, 0));
    const asteroidEdge = getAsteroidSupportRadius(asteroid, vector(-1, 0));
    asteroid.transform.position.x = shipEdge + asteroidEdge - 0.2;
    asteroid.transform.previousPosition.x = asteroid.transform.position.x;

    simulation.step(dt, neutralFlightActions());

    const snapshot = simulation.getDebugSnapshot();
    expect(snapshot.ship.hardpoints.starboard.condition).toBeLessThan(100);
    expect(snapshot.ship.hardpoints.ventral.condition).toBe(100);
  });
});
