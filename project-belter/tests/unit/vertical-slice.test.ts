import { describe, expect, it } from 'vitest';
import { neutralFlightActions } from '../../src/game/input/InputActions';
import { GameSimulation } from '../../src/game/simulation/GameSimulation';
import {
  createDefaultCareer,
  purchaseAndInstallModule,
  sellCargoIntoCareer,
} from '../../src/progression/CareerState';

const dt = 1 / 60;
const advance = (simulation: GameSimulation, seconds: number): void => {
  for (let index = 0; index < Math.ceil(seconds / dt); index += 1) {
    simulation.step(dt, neutralFlightActions());
  }
};

describe('first complete vertical slice', () => {
  it('runs launch, mining, recall, docking, sale, and upgrade as one state flow', () => {
    const career = createDefaultCareer();
    const simulation = new GameSimulation(undefined, 0xb37e_2026, career.installedModules);

    expect(simulation.phase).toBe('station');
    expect(simulation.launch()).toBe(true);
    expect(simulation.selectAsteroid(simulation.tutorialAsteroidId ?? -1)).toBe(true);
    simulation.debugTeleportNearTarget(28);
    advance(simulation, 12);
    simulation.recallDrones();
    advance(simulation, 2);
    expect(simulation.ship.cargoMass).toBeGreaterThanOrEqual(3);
    expect(simulation.entities.drones.size).toBe(0);

    simulation.debugPrepareDocking();
    advance(simulation, 2);
    expect(simulation.phase).toBe('station');

    const revenue = sellCargoIntoCareer(career, simulation.ship.cargo).revenue;
    simulation.clearCargo();
    expect(revenue).toBeGreaterThan(0);
    expect(purchaseAndInstallModule(career, 'engine-kestrel').ok).toBe(true);

    const baseThrust = simulation.ship.forwardThrust;
    simulation.applyLoadout(career.installedModules);
    expect(simulation.ship.installedModules).toContain('engine-kestrel');
    expect(simulation.ship.forwardThrust).toBeGreaterThan(baseThrust);

    const reloaded = new GameSimulation(undefined, 0xb37e_2026, career.installedModules);
    expect(reloaded.ship.installedModules).toContain('engine-kestrel');
    expect(reloaded.ship.forwardThrust).toBe(simulation.ship.forwardThrust);
  });
});
