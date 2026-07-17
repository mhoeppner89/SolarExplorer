import { describe, expect, it } from 'vitest';
import { getSideThrusterVisualState } from '../../src/game/rendering/ThrusterVisuals';

describe('hauler side-thruster visuals', () => {
  it('fires opposing fore and aft jets for clockwise rotation', () => {
    expect(getSideThrusterVisualState({ strafe: 0, steer: 1 })).toEqual({
      portFore: 1,
      portAft: 0,
      starboardFore: 0,
      starboardAft: 1,
    });
  });

  it('mirrors the pair for counter-clockwise rotation', () => {
    expect(getSideThrusterVisualState({ strafe: 0, steer: -1 })).toEqual({
      portFore: 0,
      portAft: 1,
      starboardFore: 1,
      starboardAft: 0,
    });
  });

  it('fires both jets on one side for lateral translation', () => {
    expect(getSideThrusterVisualState({ strafe: 1, steer: 0 })).toEqual({
      portFore: 1,
      portAft: 1,
      starboardFore: 0,
      starboardAft: 0,
    });
    expect(getSideThrusterVisualState({ strafe: -1, steer: 0 })).toEqual({
      portFore: 0,
      portAft: 0,
      starboardFore: 1,
      starboardAft: 1,
    });
  });
});
