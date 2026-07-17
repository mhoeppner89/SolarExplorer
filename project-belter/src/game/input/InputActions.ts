import type { Vector2 } from '../simulation/Vector2';

export interface FlightActionState {
  steer: number;
  strafe: number;
  thrustForward: number;
  thrustReverse: number;
  approachAssist: boolean;
  recallDrones: boolean;
  dockOrInteract: boolean;
  pausePressed: boolean;
  recalibrateTiltPressed: boolean;
}

export type InputCommand =
  | { type: 'selectTarget'; worldPosition: Vector2 }
  | { type: 'clearTarget' };

export interface ActionFrame {
  state: FlightActionState;
  commands: readonly InputCommand[];
}

export const neutralFlightActions = (): FlightActionState => ({
  steer: 0,
  strafe: 0,
  thrustForward: 0,
  thrustReverse: 0,
  approachAssist: false,
  recallDrones: false,
  dockOrInteract: false,
  pausePressed: false,
  recalibrateTiltPressed: false,
});

export interface InputAdapter {
  readonly id: InputMode;
  setEnabled(enabled: boolean): void;
  sample(deltaMs: number): FlightActionState;
  reset(): void;
  destroy(): void;
}

export type InputMode = 'keyboard' | 'joystick' | 'tilt';
