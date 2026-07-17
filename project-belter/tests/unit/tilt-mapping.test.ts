import { describe, expect, it } from 'vitest';
import {
  mapTiltAxis,
  mapTiltToFlight,
  normalizeDeviceOrientation,
} from '../../src/game/input/TiltMapping';

describe('tilt control mapping', () => {
  it('keeps small movements inside the dead zone at zero', () => {
    expect(mapTiltAxis(2.9, 3, 20)).toBe(0);
    expect(mapTiltAxis(-2.9, 3, 20)).toBe(0);
  });

  it('maps full roll and pitch to bounded actions', () => {
    const actions = mapTiltToFlight(
      { roll: 24, pitch: -24 },
      { roll: 0, pitch: 0 },
      { deadZoneDegrees: 3, fullInputDegrees: 20, invertPitch: false },
    );

    expect(actions.steer).toBe(1);
    expect(actions.thrustForward).toBe(1);
    expect(actions.thrustReverse).toBe(0);
  });

  it('supports reverse thrust and pitch inversion', () => {
    const normal = mapTiltToFlight(
      { roll: 0, pitch: 12 },
      { roll: 0, pitch: 0 },
      { deadZoneDegrees: 3, fullInputDegrees: 20, invertPitch: false },
    );
    const inverted = mapTiltToFlight(
      { roll: 0, pitch: 12 },
      { roll: 0, pitch: 0 },
      { deadZoneDegrees: 3, fullInputDegrees: 20, invertPitch: true },
    );

    expect(normal.thrustReverse).toBeGreaterThan(0);
    expect(inverted.thrustForward).toBeGreaterThan(0);
  });

  it('normalizes landscape orientation axes', () => {
    expect(normalizeDeviceOrientation(10, 4, 90)).toEqual({ roll: -10, pitch: 4 });
    expect(normalizeDeviceOrientation(10, 4, 270)).toEqual({ roll: 10, pitch: -4 });
  });
});
