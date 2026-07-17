import { describe, expect, it } from 'vitest';
import { joystickKnobTransform } from '../../src/game/input/VirtualJoystick';

describe('virtual joystick presentation', () => {
  it('keeps the knob centred before applying pointer displacement', () => {
    expect(joystickKnobTransform(0, 0)).toBe(
      'translate(-50%, -50%) translate3d(0.0px, 0.0px, 0)',
    );
    expect(joystickKnobTransform(12.5, -8)).toContain(
      'translate(-50%, -50%) translate3d(12.5px, -8.0px, 0)',
    );
  });
});
