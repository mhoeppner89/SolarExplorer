import { describe, expect, it } from 'vitest';
import { moduleDefinitions } from '../../src/data/gameData';
import { tuning } from '../../src/game/config/tuning';
import {
  calculateCargoValue,
  createDefaultCareer,
  normalizeCareer,
  purchaseAndInstallModule,
  sellCargoIntoCareer,
  unmountHardpoint,
} from '../../src/progression/CareerState';
import { aggregateShipStats } from '../../src/progression/ShipLoadout';
import { GameSimulation } from '../../src/game/simulation/GameSimulation';

describe('career economy and loadout', () => {
  it('sells resource cargo and purchases a handling upgrade', () => {
    const career = createDefaultCareer();
    const cargo = { water: 0, industrial: 6, rare: 0 };
    expect(calculateCargoValue(cargo)).toBe(252);

    const sale = sellCargoIntoCareer(career, cargo);
    expect(sale.revenue).toBe(252);
    expect(career.credits).toBe(372);
    expect(cargo).toEqual({ water: 0, industrial: 0, rare: 0 });

    const purchase = purchaseAndInstallModule(career, 'engine-kestrel');
    expect(purchase.ok).toBe(true);
    expect(career.credits).toBe(72);
    expect(career.installedModules).toContain('engine-kestrel');

    const stats = aggregateShipStats({
      dryMass: tuning.ship.dryMass,
      cargoCapacity: tuning.ship.cargoCapacity,
      forwardThrust: tuning.ship.forwardThrust,
      reverseThrust: tuning.ship.reverseThrust,
      rotationalAcceleration: tuning.ship.rotationalAcceleration,
    }, career.installedModules);
    expect(stats.forwardThrust).toBeCloseTo(
      tuning.ship.forwardThrust * moduleDefinitions['engine-kestrel'].forwardThrustMultiplier,
    );
    expect(stats.dryMass).toBeGreaterThan(tuning.ship.dryMass);
  });

  it('round-trips progression through the versioned save shape', () => {
    const career = createDefaultCareer();
    career.credits = 777;
    career.ownedModules = ['mining-drone', 'retro-brace'];
    career.installedModules = ['retro-brace'];
    career.hardpointLoadout = {
      port: 'retro-brace',
      starboard: null,
      ventral: null,
    };
    career.stats.expeditionsCompleted = 3;
    career.tutorialComplete = true;

    const restored = normalizeCareer(JSON.parse(JSON.stringify(career)) as Partial<typeof career>);
    expect(restored).toEqual(career);
  });

  it('unlocks guided approach only after buying the flight-assist module', () => {
    const career = createDefaultCareer();
    career.credits = moduleDefinitions['flight-assist'].purchasePrice;
    const simulation = new GameSimulation();
    simulation.launch();
    simulation.selectAsteroid(simulation.tutorialAsteroidId ?? -1);
    expect(simulation.toggleApproachAssist()).toBe(false);

    expect(purchaseAndInstallModule(career, 'flight-assist').ok).toBe(true);
    expect(career.hardpointLoadout).toEqual({
      port: null,
      starboard: null,
      ventral: 'mining-drone',
    });
    expect(career.installedModules).toContain('flight-assist');
    simulation.applyLoadout(career.installedModules);
    expect(simulation.toggleApproachAssist()).toBe(true);
  });

  it('migrates a previously hardpoint-mounted Wayfinder into the internal bay', () => {
    const career = createDefaultCareer();
    career.ownedModules.push('flight-assist');
    career.installedModules.push('flight-assist');
    career.hardpointLoadout.port = 'flight-assist';

    const restored = normalizeCareer(career);

    expect(restored.hardpointLoadout.port).toBeNull();
    expect(restored.installedModules).toContain('flight-assist');
  });

  it('persists an intentionally empty drone hardpoint', () => {
    const career = createDefaultCareer();
    unmountHardpoint(career, 'ventral');

    const restored = normalizeCareer(JSON.parse(JSON.stringify(career)) as Partial<typeof career>);

    expect(restored.hardpointLoadout.ventral).toBeNull();
    expect(restored.installedModules).not.toContain('mining-drone');
  });

  it('can purchase and mount additional copies of the same equipment', () => {
    const career = createDefaultCareer();
    career.credits = moduleDefinitions['mining-drone'].purchasePrice * 2;

    expect(purchaseAndInstallModule(career, 'mining-drone').ok).toBe(true);
    expect(purchaseAndInstallModule(career, 'mining-drone').ok).toBe(true);

    expect(career.ownedModules.filter((moduleId) => moduleId === 'mining-drone')).toHaveLength(3);
    expect(career.installedModules.filter((moduleId) => moduleId === 'mining-drone')).toHaveLength(3);
    expect(Object.values(career.hardpointLoadout)).toEqual([
      'mining-drone',
      'mining-drone',
      'mining-drone',
    ]);
  });
});
