import { describe, expect, it } from 'vitest';
import { tuning } from '../../src/game/config/tuning';
import { GameSimulation } from '../../src/game/simulation/GameSimulation';

const dt = 1 / tuning.simulationHz;

describe('NPC trader shuttle', () => {
  it('can be selected in space and plotted as a guide without auto-engaging Wayfinder', () => {
    const simulation = new GameSimulation(undefined, 0xb37e_2026, ['flight-assist']);
    simulation.launch();
    const trader = [...simulation.entities.traders.values()][0];
    expect(trader).toBeDefined();
    if (trader === undefined) {
      return;
    }

    const selected = simulation.selectTargetAt({ ...trader.transform.position });
    const snapshot = simulation.getDebugSnapshot();

    expect(selected).toEqual({ kind: 'trader', id: trader.id });
    expect(snapshot.target?.kind).toBe('trader');
    expect(snapshot.navigationBeacon?.id).toBe(`trader:${trader.id}`);
    expect(snapshot.autopilot.path.length).toBeGreaterThan(0);
    expect(snapshot.autopilot.enabled).toBe(false);
    expect(simulation.toggleAutopilot()).toBe(true);
  });

  it('docks briefly, crosses to the other station, and begins the return cycle', () => {
    const simulation = new GameSimulation(undefined, 0xb37e_2026);
    simulation.launch();
    const trader = [...simulation.entities.traders.values()][0];
    expect(trader).toBeDefined();
    if (trader === undefined) {
      return;
    }
    const originId = trader.currentStationId;
    const firstDestinationId = trader.destinationStationId;
    expect(trader.state).toBe('docked');

    for (let index = 0; index < tuning.simulationHz * 8; index += 1) {
      simulation.step(dt);
      if (trader.state === 'traveling') {
        break;
      }
    }
    expect(trader.state).toBe('traveling');
    expect(trader.route.length).toBeGreaterThan(0);

    for (let index = 0; index < tuning.simulationHz * 180; index += 1) {
      simulation.step(dt);
      if (trader.state === 'docked' && trader.currentStationId === firstDestinationId) {
        break;
      }
    }
    expect(trader.state).toBe('docked');
    expect(trader.currentStationId).toBe(firstDestinationId);
    expect(trader.destinationStationId).toBe(originId);

    for (let index = 0; index < tuning.simulationHz * 8; index += 1) {
      simulation.step(dt);
      if (trader.state === 'traveling') {
        break;
      }
    }
    expect(trader.state).toBe('traveling');
    expect(trader.destinationStationId).toBe(originId);
  }, 15_000);
});
