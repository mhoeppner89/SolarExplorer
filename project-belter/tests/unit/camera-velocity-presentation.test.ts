import { describe, expect, it } from 'vitest';
import type { PlayerSettings } from '../../src/app/PlayerSettings';
import { getCameraTargetZoom } from '../../src/game/rendering/CameraRig';
import { getVelocityVectorPresentation } from '../../src/game/rendering/VelocityVectorView';

const settings: PlayerSettings = {
  controlMode: 'joystick',
  tiltSensitivity: 1,
  tiltDeadZoneDegrees: 3,
  invertPitch: false,
  dynamicZoom: true,
  stationaryZoomMultiplier: 0.8,
  maximumSpeedZoomMultiplier: 0.3,
  screenShake: 0.65,
  reducedMotion: false,
  debugVisible: false,
};

describe('camera and velocity presentation', () => {
  it('interpolates between saved stationary and 150 m/s zoom levels', () => {
    expect(getCameraTargetZoom(1.5, 0, settings)).toBeCloseTo(1.2, 8);
    expect(getCameraTargetZoom(1.5, 75, settings)).toBeCloseTo(0.825, 8);
    expect(getCameraTargetZoom(1.5, 150, settings)).toBeCloseTo(0.45, 8);
  });

  it('keeps arrow length capped after 100 m/s while increasing weight and warning color', () => {
    const atHundred = getVelocityVectorPresentation(100);
    const warning = getVelocityVectorPresentation(130);
    const maximum = getVelocityVectorPresentation(150);

    expect(warning.length).toBe(atHundred.length);
    expect(maximum.length).toBe(atHundred.length);
    expect(warning.lineWidth).toBeGreaterThan(atHundred.lineWidth);
    expect(maximum.lineWidth).toBeGreaterThan(warning.lineWidth);
    expect(warning.color).toBe(0xffc45f);
    expect(maximum.color).toBe(0xff625b);
    expect(warning.warning).toContain('HIGH VELOCITY');
    expect(maximum.warning).toContain('MAX SPEED LIMIT');
  });
});
