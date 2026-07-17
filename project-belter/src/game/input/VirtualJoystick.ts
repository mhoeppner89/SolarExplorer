import {
  neutralFlightActions,
  type FlightActionState,
  type InputAdapter,
} from './InputActions';

export interface VirtualJoystickElements {
  root: HTMLElement;
  pad: HTMLElement;
  knob: HTMLElement;
}

export const joystickKnobTransform = (x: number, y: number): string =>
  `translate(-50%, -50%) translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;

export class VirtualJoystick implements InputAdapter {
  public readonly id = 'joystick' as const;
  private enabled = false;
  private pointerId: number | null = null;
  private steer = 0;
  private thrustForward = 0;
  private thrustReverse = 0;

  public constructor(private readonly elements: VirtualJoystickElements) {
    elements.pad.addEventListener('pointerdown', this.handlePointerDown);
    elements.pad.addEventListener('pointermove', this.handlePointerMove);
    elements.pad.addEventListener('pointerup', this.handlePointerUp);
    elements.pad.addEventListener('pointercancel', this.handlePointerUp);
    elements.pad.addEventListener('lostpointercapture', this.handlePointerUp);
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.elements.root.toggleAttribute('data-active', enabled);
    this.elements.root.setAttribute('aria-hidden', String(!enabled));
    if (!enabled) {
      this.reset();
    }
  }

  public sample(): FlightActionState {
    if (!this.enabled) {
      return neutralFlightActions();
    }
    return {
      ...neutralFlightActions(),
      steer: this.steer,
      thrustForward: this.thrustForward,
      thrustReverse: this.thrustReverse,
    };
  }

  public reset(): void {
    this.pointerId = null;
    this.steer = 0;
    this.thrustForward = 0;
    this.thrustReverse = 0;
    this.elements.knob.style.transform = joystickKnobTransform(0, 0);
  }

  public destroy(): void {
    this.elements.pad.removeEventListener('pointerdown', this.handlePointerDown);
    this.elements.pad.removeEventListener('pointermove', this.handlePointerMove);
    this.elements.pad.removeEventListener('pointerup', this.handlePointerUp);
    this.elements.pad.removeEventListener('pointercancel', this.handlePointerUp);
    this.elements.pad.removeEventListener('lostpointercapture', this.handlePointerUp);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!this.enabled || this.pointerId !== null) {
      return;
    }
    event.preventDefault();
    this.pointerId = event.pointerId;
    this.elements.pad.setPointerCapture(event.pointerId);
    this.updateFromPointer(event);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.enabled || event.pointerId !== this.pointerId) {
      return;
    }
    event.preventDefault();
    this.updateFromPointer(event);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) {
      return;
    }
    event.preventDefault();
    this.reset();
  };

  private updateFromPointer(event: PointerEvent): void {
    const bounds = this.elements.pad.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const maximumRadius = Math.max(1, Math.min(bounds.width, bounds.height) * 0.37);
    const rawX = event.clientX - centerX;
    const rawY = event.clientY - centerY;
    const distance = Math.hypot(rawX, rawY);
    const scale = distance > maximumRadius ? maximumRadius / distance : 1;
    const clampedX = rawX * scale;
    const clampedY = rawY * scale;

    this.elements.knob.style.transform = joystickKnobTransform(clampedX, clampedY);
    this.steer = Math.min(1, Math.max(-1, clampedX / maximumRadius));
    const thrustAxis = Math.min(1, Math.max(-1, -clampedY / maximumRadius));
    this.thrustForward = Math.max(0, thrustAxis);
    this.thrustReverse = Math.max(0, -thrustAxis);
  }
}
