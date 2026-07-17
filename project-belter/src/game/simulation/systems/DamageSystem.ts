import type { CollisionSeverity } from '../events';

export interface CollisionDamageResult {
  damage: number;
  severity: CollisionSeverity;
}

export const calculateCollisionDamage = (
  relativeSpeed: number,
  effectiveRadius: number,
  safeContactSpeed: number,
  minorDamageSpeed: number,
  seriousDamageSpeed: number,
): CollisionDamageResult => {
  const speed = Math.max(0, relativeSpeed);
  const massFactor = Math.min(1.2, Math.max(0.65, effectiveRadius / 28));

  if (speed < safeContactSpeed) {
    return { damage: 0, severity: 'safe' };
  }

  if (speed < minorDamageSpeed) {
    return {
      damage: (speed - safeContactSpeed) * 0.45 * massFactor,
      severity: 'minor',
    };
  }

  if (speed < seriousDamageSpeed) {
    const minorBandDamage = (minorDamageSpeed - safeContactSpeed) * 0.45;
    return {
      damage: (minorBandDamage + (speed - minorDamageSpeed) * 1.05) * massFactor,
      severity: 'serious',
    };
  }

  const minorBandDamage = (minorDamageSpeed - safeContactSpeed) * 0.45;
  const seriousBandDamage = (seriousDamageSpeed - minorDamageSpeed) * 1.05;
  return {
    damage: (minorBandDamage + seriousBandDamage + (speed - seriousDamageSpeed) * 2.2) * massFactor,
    severity: 'severe',
  };
};
