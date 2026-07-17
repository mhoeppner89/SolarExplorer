import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayerSettingsStore } from '../../src/app/PlayerSettings';
import { SAVE_SETTINGS_KEY } from '../../src/game/config/constants';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('player camera settings', () => {
  it('persists and reloads wide stationary and maximum-speed zoom choices', () => {
    const stored = new Map<string, string>();
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    vi.stubGlobal('location', { search: '' });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    });

    const first = new PlayerSettingsStore();
    first.patch({
      stationaryZoomMultiplier: 0.3,
      maximumSpeedZoomMultiplier: 0.22,
    });
    expect(stored.has(SAVE_SETTINGS_KEY)).toBe(true);

    const reloaded = new PlayerSettingsStore();
    expect(reloaded.value.stationaryZoomMultiplier).toBe(0.3);
    expect(reloaded.value.maximumSpeedZoomMultiplier).toBe(0.22);
  });
});
