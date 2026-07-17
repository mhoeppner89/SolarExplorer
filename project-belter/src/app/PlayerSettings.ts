import { SAVE_SETTINGS_KEY } from '../game/config/constants';
import type { InputMode } from '../game/input/InputActions';

export interface PlayerSettings {
  controlMode: InputMode;
  tiltSensitivity: number;
  tiltDeadZoneDegrees: number;
  invertPitch: boolean;
  dynamicZoom: boolean;
  stationaryZoomMultiplier: number;
  maximumSpeedZoomMultiplier: number;
  screenShake: number;
  reducedMotion: boolean;
  debugVisible: boolean;
}

export const createDefaultSettings = (): PlayerSettings => ({
  controlMode: matchMedia('(pointer: coarse)').matches ? 'joystick' : 'keyboard',
  tiltSensitivity: 1,
  tiltDeadZoneDegrees: 3,
  invertPitch: false,
  dynamicZoom: true,
  stationaryZoomMultiplier: 1,
  maximumSpeedZoomMultiplier: 0.86,
  screenShake: 0.65,
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  debugVisible: new URLSearchParams(location.search).has('debug'),
});

const isInputMode = (value: unknown): value is InputMode =>
  value === 'keyboard' || value === 'joystick' || value === 'tilt';

export class PlayerSettingsStore {
  private settings: PlayerSettings;
  private readonly listeners = new Set<(settings: Readonly<PlayerSettings>) => void>();

  public constructor() {
    this.settings = this.load();
  }

  public get value(): Readonly<PlayerSettings> {
    return this.settings;
  }

  public patch(update: Partial<PlayerSettings>): void {
    this.settings = this.validate({ ...this.settings, ...update });
    this.persist();
    for (const listener of this.listeners) {
      listener(this.settings);
    }
  }

  public subscribe(listener: (settings: Readonly<PlayerSettings>) => void): () => void {
    this.listeners.add(listener);
    listener(this.settings);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private load(): PlayerSettings {
    const defaults = createDefaultSettings();
    try {
      const serialized = localStorage.getItem(SAVE_SETTINGS_KEY);
      if (serialized === null) {
        return defaults;
      }
      const parsed = JSON.parse(serialized) as Partial<PlayerSettings>;
      return this.validate({ ...defaults, ...parsed });
    } catch {
      return defaults;
    }
  }

  private validate(candidate: PlayerSettings): PlayerSettings {
    return {
      controlMode: isInputMode(candidate.controlMode) ? candidate.controlMode : 'joystick',
      tiltSensitivity: Math.min(1.6, Math.max(0.55, Number(candidate.tiltSensitivity) || 1)),
      tiltDeadZoneDegrees: Math.min(8, Math.max(1, Number(candidate.tiltDeadZoneDegrees) || 3)),
      invertPitch: Boolean(candidate.invertPitch),
      dynamicZoom: Boolean(candidate.dynamicZoom),
      stationaryZoomMultiplier: Math.min(
        1.3,
        Math.max(0.3, Number(candidate.stationaryZoomMultiplier) || 1),
      ),
      maximumSpeedZoomMultiplier: Math.min(
        1.3,
        Math.max(0.22, Number(candidate.maximumSpeedZoomMultiplier) || 0.86),
      ),
      screenShake: Math.min(1, Math.max(0, Number(candidate.screenShake) || 0)),
      reducedMotion: Boolean(candidate.reducedMotion),
      debugVisible: Boolean(candidate.debugVisible),
    };
  }

  private persist(): void {
    try {
      localStorage.setItem(SAVE_SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // Settings remain active for the current session when storage is unavailable.
    }
  }
}
