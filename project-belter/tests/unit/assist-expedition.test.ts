import { describe, expect, it } from 'vitest';
import { neutralFlightActions } from '../../src/game/input/InputActions';
import { GameSimulation } from '../../src/game/simulation/GameSimulation';

const dt = 1 / 60;

describe('assisted expedition path', () => {
  it('stays locked until the station flight-assist module is installed', () => {
    const simulation = new GameSimulation();
    simulation.launch();
    simulation.selectAsteroid(simulation.tutorialAsteroidId ?? -1);

    expect(simulation.toggleApproachAssist()).toBe(false);
    expect(simulation.getDebugSnapshot().contextActionLabel).toBe('ASSIST LOCKED');
  });

  it('uses ordinary thrusters to rendezvous with the tutorial asteroid', () => {
    const simulation = new GameSimulation(undefined, 0xb37e_2026, ['flight-assist']);
    simulation.launch();
    expect(simulation.selectAsteroid(simulation.tutorialAsteroidId ?? -1)).toBe(true);
    expect(simulation.toggleApproachAssist()).toBe(true);

    let minimumDistance = Number.POSITIVE_INFINITY;
    let minimumRelativeSpeed = Number.POSITIVE_INFINITY;
    let enteredEnvelope = false;
    for (let index = 0; index < 60 * 90; index += 1) {
      simulation.step(dt, neutralFlightActions());
      const snapshot = simulation.getDebugSnapshot();
      if (snapshot.target !== null) {
        minimumDistance = Math.min(minimumDistance, snapshot.target.distanceToSurface);
        minimumRelativeSpeed = Math.min(minimumRelativeSpeed, snapshot.target.relativeSpeed);
        if (
          snapshot.target.distanceToSurface <= simulation.config.mining.distanceFromSurface
          && snapshot.target.relativeSpeed <= simulation.config.mining.armRelativeSpeed
        ) {
          enteredEnvelope = true;
          break;
        }
      }
    }

    expect(enteredEnvelope, `min distance ${minimumDistance.toFixed(2)}, min relative ${minimumRelativeSpeed.toFixed(2)}`).toBe(true);
    expect(simulation.ship.fuel).toBeLessThan(simulation.ship.fuelCapacity);
    expect(simulation.getDebugSnapshot().assistMode).toBe('approach');
  });

  it('can mine and return to the station through bounded assistance without teleporting', () => {
    const simulation = new GameSimulation(undefined, 0xb37e_2026, ['flight-assist']);
    simulation.launch();
    simulation.selectAsteroid(simulation.tutorialAsteroidId ?? -1);
    simulation.toggleApproachAssist();

    for (let index = 0; index < 60 * 120 && simulation.ship.cargoMass < 3; index += 1) {
      simulation.step(dt, neutralFlightActions());
    }
    expect(simulation.ship.cargoMass).toBeGreaterThanOrEqual(3);

    simulation.recallDrones();
    for (let index = 0; index < 60 * 20 && simulation.entities.drones.size > 0; index += 1) {
      simulation.step(dt, neutralFlightActions());
    }
    expect(simulation.entities.drones.size).toBe(0);

    simulation.selectStation(true);
    for (let index = 0; index < 60 * 150 && simulation.phase !== 'station'; index += 1) {
      simulation.step(dt, neutralFlightActions());
    }
    expect(simulation.phase).toBe('station');
    expect(simulation.ship.cargoMass).toBeGreaterThanOrEqual(3);
  });
});
