export interface TiltMappingSettings {
  deadZoneDegrees: number;
  fullInputDegrees: number;
  invertPitch: boolean;
}

export interface NormalizedOrientation {
  roll: number;
  pitch: number;
}

export const normalizeDeviceOrientation = (
  beta: number,
  gamma: number,
  screenAngleDegrees: number,
): NormalizedOrientation => {
  const angle = ((screenAngleDegrees % 360) + 360) % 360;

  if (angle === 90) {
    return { roll: -beta, pitch: gamma };
  }
  if (angle === 270) {
    return { roll: beta, pitch: -gamma };
  }
  if (angle === 180) {
    return { roll: -gamma, pitch: -beta };
  }
  return { roll: gamma, pitch: beta };
};

export const mapTiltAxis = (
  deltaDegrees: number,
  deadZoneDegrees: number,
  fullInputDegrees: number,
): number => {
  const magnitude = Math.abs(deltaDegrees);
  if (magnitude <= deadZoneDegrees) {
    return 0;
  }
  const availableRange = Math.max(0.001, fullInputDegrees - deadZoneDegrees);
  const normalized = Math.min(1, (magnitude - deadZoneDegrees) / availableRange);
  return Math.sign(deltaDegrees) * normalized;
};

export const mapTiltToFlight = (
  current: NormalizedOrientation,
  neutral: NormalizedOrientation,
  settings: TiltMappingSettings,
): { steer: number; thrustForward: number; thrustReverse: number } => {
  const steer = mapTiltAxis(
    current.roll - neutral.roll,
    settings.deadZoneDegrees,
    settings.fullInputDegrees,
  );

  const pitchSign = settings.invertPitch ? -1 : 1;
  const thrustAxis = mapTiltAxis(
    (neutral.pitch - current.pitch) * pitchSign,
    settings.deadZoneDegrees,
    settings.fullInputDegrees,
  );

  return {
    steer,
    thrustForward: Math.max(0, thrustAxis),
    thrustReverse: Math.max(0, -thrustAxis),
  };
};
