import type { PlayerSettings } from '../../app/PlayerSettings';
import { tuning } from '../config/tuning';
import {
  neutralFlightActions,
  type FlightActionState,
  type InputAdapter,
} from './InputActions';
import {
  mapTiltToFlight,
  normalizeDeviceOrientation,
  type NormalizedOrientation,
} from './TiltMapping';

type PermissionState = 'unknown' | 'granted' | 'denied' | 'unavailable';

type DeviceOrientationEventConstructorWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

export interface TiltStatus {
  permission: PermissionState;
  calibrated: boolean;
  receivingData: boolean;
}

export class TiltController implements InputAdapter {
  public readonly id = 'tilt' as const;
  private enabled = false;
  private listening = false;
  private permission: PermissionState = 'unknown';
  private current: NormalizedOrientation | null = null;
  private neutral: NormalizedOrientation | null = null;
  private smoothedSteer = 0;
  private smoothedForward = 0;
  private smoothedReverse = 0;
  private readonly statusListeners = new Set<(status: TiltStatus) => void>();

  public constructor(private readonly getSettings: () => Readonly<PlayerSettings>) {
    if (!('DeviceOrientationEvent' in window)) {
      this.permission = 'unavailable';
    }
    window.addEventListener('orientationchange', this.handleOrientationChange);
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.resetOutputs();
    }
  }

  public async requestPermission(): Promise<boolean> {
    if (!('DeviceOrientationEvent' in window)) {
      this.permission = 'unavailable';
      this.emitStatus();
      return false;
    }

    try {
      const orientationConstructor = DeviceOrientationEvent as DeviceOrientationEventConstructorWithPermission;
      const permission = orientationConstructor.requestPermission === undefined
        ? 'granted'
        : await orientationConstructor.requestPermission();

      this.permission = permission === 'granted' ? 'granted' : 'denied';
      if (this.permission === 'granted') {
        this.startListening();
      }
      this.emitStatus();
      return this.permission === 'granted';
    } catch {
      this.permission = 'denied';
      this.emitStatus();
      return false;
    }
  }

  public async waitForData(timeoutMs = 700): Promise<boolean> {
    if (this.current !== null) {
      return true;
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      let timeout = 0;
      let unsubscribe: () => void = () => undefined;
      const finish = (receivingData: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeout);
        unsubscribe();
        resolve(receivingData);
      };
      timeout = window.setTimeout(() => {
        finish(this.current !== null);
      }, timeoutMs);
      unsubscribe = this.subscribe((status) => {
        if (status.receivingData) {
          finish(true);
        }
      });
    });
  }

  public calibrate(): boolean {
    if (this.current === null) {
      this.emitStatus();
      return false;
    }
    this.neutral = { ...this.current };
    this.resetOutputs();
    this.emitStatus();
    return true;
  }

  public sample(deltaMs: number): FlightActionState {
    if (!this.enabled || this.permission !== 'granted' || this.current === null || this.neutral === null) {
      return neutralFlightActions();
    }

    const settings = this.getSettings();
    const mapped = mapTiltToFlight(this.current, this.neutral, {
      deadZoneDegrees: settings.tiltDeadZoneDegrees,
      fullInputDegrees: tuning.tiltFullInputDegrees / settings.tiltSensitivity,
      invertPitch: settings.invertPitch,
    });
    const smoothingAlpha = 1 - Math.exp(-Math.max(0, deltaMs) / tuning.tiltSmoothingMs);
    this.smoothedSteer += (mapped.steer - this.smoothedSteer) * smoothingAlpha;
    this.smoothedForward += (mapped.thrustForward - this.smoothedForward) * smoothingAlpha;
    this.smoothedReverse += (mapped.thrustReverse - this.smoothedReverse) * smoothingAlpha;

    return {
      ...neutralFlightActions(),
      steer: this.smoothedSteer,
      thrustForward: this.smoothedForward,
      thrustReverse: this.smoothedReverse,
    };
  }

  public reset(): void {
    this.neutral = null;
    this.resetOutputs();
    this.emitStatus();
  }

  public destroy(): void {
    if (this.listening) {
      window.removeEventListener('deviceorientation', this.handleOrientation);
    }
    window.removeEventListener('orientationchange', this.handleOrientationChange);
    this.statusListeners.clear();
  }

  public subscribe(listener: (status: TiltStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  public get status(): TiltStatus {
    return {
      permission: this.permission,
      calibrated: this.neutral !== null,
      receivingData: this.current !== null,
    };
  }

  private startListening(): void {
    if (this.listening) {
      return;
    }
    this.listening = true;
    window.addEventListener('deviceorientation', this.handleOrientation, { passive: true });
  }

  private readonly handleOrientation = (event: DeviceOrientationEvent): void => {
    if (event.beta === null || event.gamma === null) {
      return;
    }
    const screenAngle = screen.orientation?.angle ?? window.orientation ?? 0;
    this.current = normalizeDeviceOrientation(event.beta, event.gamma, Number(screenAngle));
    this.emitStatus();
  };

  private readonly handleOrientationChange = (): void => {
    this.neutral = null;
    this.resetOutputs();
    this.emitStatus();
  };

  private resetOutputs(): void {
    this.smoothedSteer = 0;
    this.smoothedForward = 0;
    this.smoothedReverse = 0;
  }

  private emitStatus(): void {
    const status = this.status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }
}
