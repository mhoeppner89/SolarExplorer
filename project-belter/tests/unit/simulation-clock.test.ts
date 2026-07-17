import { describe, expect, it } from 'vitest';
import { SimulationClock } from '../../src/game/simulation/SimulationClock';

describe('SimulationClock', () => {
  it('converts variable render deltas into fixed simulation steps', () => {
    const clock = new SimulationClock(60, 250, 8);
    let steps = 0;

    const first = clock.advance(10, () => {
      steps += 1;
    });
    const second = clock.advance(23.5, () => {
      steps += 1;
    });

    expect(first.steps).toBe(0);
    expect(second.steps).toBe(2);
    expect(steps).toBe(2);
    expect(second.interpolationAlpha).toBeGreaterThanOrEqual(0);
    expect(second.interpolationAlpha).toBeLessThan(1);
  });

  it('limits catch-up work and reports dropped time', () => {
    const clock = new SimulationClock(60, 250, 3);
    const result = clock.advance(250, () => undefined);

    expect(result.steps).toBe(3);
    expect(result.droppedSeconds).toBeGreaterThan(0.19);
  });
});
