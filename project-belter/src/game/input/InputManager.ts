import type { PlayerSettingsStore } from '../../app/PlayerSettings';
import { KeyboardController } from './KeyboardController';
import {
  neutralFlightActions,
  type ActionFrame,
  type FlightActionState,
  type InputAdapter,
  type InputMode,
} from './InputActions';
import { TiltController, type TiltStatus } from './TiltController';
import { VirtualJoystick, type VirtualJoystickElements } from './VirtualJoystick';

export interface InputManagerCallbacks {
  onModeChanged: (mode: InputMode) => void;
  onTiltStatusChanged: (status: TiltStatus) => void;
  onTiltFallback: (reason: 'denied' | 'unavailable' | 'no-data') => void;
}

export class InputManager {
  private readonly adapters: Record<InputMode, InputAdapter>;
  private readonly tilt: TiltController;
  private activeMode: InputMode;
  private suspended = false;
  private externalActions = neutralFlightActions();
  private readonly unsubscribeSettings: () => void;
  private readonly unsubscribeTilt: () => void;

  public constructor(
    private readonly settings: PlayerSettingsStore,
    joystickElements: VirtualJoystickElements,
    private readonly callbacks: InputManagerCallbacks,
  ) {
    const keyboard = new KeyboardController();
    const joystick = new VirtualJoystick(joystickElements);
    this.tilt = new TiltController(() => settings.value);
    this.adapters = { keyboard, joystick, tilt: this.tilt };
    this.activeMode = settings.value.controlMode;

    this.unsubscribeSettings = settings.subscribe((value) => {
      if (value.controlMode !== this.activeMode) {
        this.setMode(value.controlMode, false);
      }
    });
    this.unsubscribeTilt = this.tilt.subscribe((status) => {
      this.callbacks.onTiltStatusChanged(status);
    });
    this.setMode(this.activeMode, false);
  }

  public sample(deltaMs: number): ActionFrame {
    if (this.suspended) {
      return { state: neutralFlightActions(), commands: [] };
    }
    const adapter = this.adapters[this.activeMode].sample(deltaMs);
    const state: FlightActionState = {
      steer: Math.abs(this.externalActions.steer) > Math.abs(adapter.steer)
        ? this.externalActions.steer
        : adapter.steer,
      strafe: Math.abs(this.externalActions.strafe) > Math.abs(adapter.strafe)
        ? this.externalActions.strafe
        : adapter.strafe,
      thrustForward: Math.max(adapter.thrustForward, this.externalActions.thrustForward),
      thrustReverse: Math.max(adapter.thrustReverse, this.externalActions.thrustReverse),
      approachAssist: adapter.approachAssist || this.externalActions.approachAssist,
      recallDrones: adapter.recallDrones || this.externalActions.recallDrones,
      dockOrInteract: adapter.dockOrInteract || this.externalActions.dockOrInteract,
      pausePressed: adapter.pausePressed || this.externalActions.pausePressed,
      recalibrateTiltPressed: adapter.recalibrateTiltPressed || this.externalActions.recalibrateTiltPressed,
    };
    return { state: this.sanitize(state), commands: [] };
  }

  public setExternalAction(
    action: keyof FlightActionState,
    value: number | boolean,
  ): void {
    if (action === 'steer' || action === 'strafe') {
      this.externalActions[action] = Number(value);
    } else if (action === 'thrustForward' || action === 'thrustReverse') {
      this.externalActions[action] = Number(value);
    } else {
      this.externalActions[action] = Boolean(value);
    }
  }

  public clearExternalActions(): void {
    this.externalActions = neutralFlightActions();
  }

  public setMode(mode: InputMode, persist = true): void {
    for (const adapter of Object.values(this.adapters)) {
      adapter.setEnabled(adapter.id === mode);
    }
    this.activeMode = mode;
    if (persist && this.settings.value.controlMode !== mode) {
      this.settings.patch({ controlMode: mode });
    }
    this.callbacks.onModeChanged(mode);
  }

  public async enableTilt(): Promise<boolean> {
    const enabled = await this.tilt.requestPermission();
    if (!enabled) {
      const permission = this.tilt.status.permission;
      this.setMode('joystick');
      this.callbacks.onTiltFallback(permission === 'unavailable' ? 'unavailable' : 'denied');
      return false;
    }
    const hasData = await this.tilt.waitForData();
    if (!hasData) {
      this.setMode('joystick');
      this.callbacks.onTiltFallback('no-data');
      return false;
    }

    this.setMode('tilt');
    this.tilt.calibrate();
    return true;
  }

  public calibrateTilt(): boolean {
    return this.tilt.calibrate();
  }

  public setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    if (suspended) {
      this.clearExternalActions();
      for (const adapter of Object.values(this.adapters)) {
        adapter.reset();
      }
    }
  }

  public get mode(): InputMode {
    return this.activeMode;
  }

  public get tiltStatus(): TiltStatus {
    return this.tilt.status;
  }

  public destroy(): void {
    this.unsubscribeSettings();
    this.unsubscribeTilt();
    for (const adapter of Object.values(this.adapters)) {
      adapter.destroy();
    }
  }

  private sanitize(state: FlightActionState): FlightActionState {
    return {
      ...state,
      steer: Math.min(1, Math.max(-1, Number.isFinite(state.steer) ? state.steer : 0)),
      strafe: Math.min(1, Math.max(-1, Number.isFinite(state.strafe) ? state.strafe : 0)),
      thrustForward: Math.min(1, Math.max(0, Number.isFinite(state.thrustForward) ? state.thrustForward : 0)),
      thrustReverse: Math.min(1, Math.max(0, Number.isFinite(state.thrustReverse) ? state.thrustReverse : 0)),
    };
  }
}
