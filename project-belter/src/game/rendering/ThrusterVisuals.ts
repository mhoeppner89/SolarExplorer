import type { FlightActionState } from '../input/InputActions';

export interface SideThrusterVisualState {
  portFore: number;
  portAft: number;
  starboardFore: number;
  starboardAft: number;
}

const clampUnit = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Positive steer rotates clockwise: the forward port jet and aft starboard
 * jet fire as an opposing pair around the ship's centre. Negative steer
 * mirrors that pair. Strafing uses both jets on the side opposite the force.
 */
export const getSideThrusterVisualState = (
  actions: Pick<FlightActionState, 'strafe' | 'steer'>,
): SideThrusterVisualState => {
  const strafeRight = clampUnit(actions.strafe);
  const strafeLeft = clampUnit(-actions.strafe);
  const turnClockwise = clampUnit(actions.steer);
  const turnCounterClockwise = clampUnit(-actions.steer);

  return {
    portFore: Math.max(strafeRight, turnClockwise),
    portAft: Math.max(strafeRight, turnCounterClockwise),
    starboardFore: Math.max(strafeLeft, turnCounterClockwise),
    starboardAft: Math.max(strafeLeft, turnClockwise),
  };
};
