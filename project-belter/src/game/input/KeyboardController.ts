import {
  neutralFlightActions,
  type FlightActionState,
  type InputAdapter,
} from './InputActions';

const CONTROL_KEYS = new Set([
  'KeyA', 'KeyD', 'KeyW', 'KeyS',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'Escape', 'KeyC',
]);

export class KeyboardController implements InputAdapter {
  public readonly id = 'keyboard' as const;
  private readonly keysDown = new Set<string>();
  private pauseEdge = false;
  private recalibrateEdge = false;
  private enabled = false;

  public constructor() {
    window.addEventListener('keydown', this.handleKeyDown, { passive: false });
    window.addEventListener('keyup', this.handleKeyUp, { passive: false });
    window.addEventListener('blur', this.handleBlur);
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.reset();
    }
  }

  public sample(): FlightActionState {
    if (!this.enabled) {
      return neutralFlightActions();
    }

    const state = neutralFlightActions();
    state.steer = Number(this.isDown('KeyD', 'ArrowRight')) - Number(this.isDown('KeyA', 'ArrowLeft'));
    state.strafe = Number(this.isDown('KeyE')) - Number(this.isDown('KeyQ'));
    state.thrustForward = Number(this.isDown('KeyW', 'ArrowUp'));
    state.thrustReverse = Number(this.isDown('KeyS', 'ArrowDown'));
    state.recallDrones = this.isDown('KeyR');
    state.dockOrInteract = this.isDown('KeyF');
    state.pausePressed = this.pauseEdge;
    state.recalibrateTiltPressed = this.recalibrateEdge;
    this.pauseEdge = false;
    this.recalibrateEdge = false;
    return state;
  }

  public reset(): void {
    this.keysDown.clear();
    this.pauseEdge = false;
    this.recalibrateEdge = false;
  }

  public destroy(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || !CONTROL_KEYS.has(event.code)) {
      return;
    }
    event.preventDefault();
    if (!event.repeat && event.code === 'Escape') {
      this.pauseEdge = true;
    }
    if (!event.repeat && event.code === 'KeyC') {
      this.recalibrateEdge = true;
    }
    this.keysDown.add(event.code);
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (!CONTROL_KEYS.has(event.code)) {
      return;
    }
    event.preventDefault();
    this.keysDown.delete(event.code);
  };

  private readonly handleBlur = (): void => {
    this.reset();
  };

  private isDown(...codes: string[]): boolean {
    return codes.some((code) => this.keysDown.has(code));
  }
}
