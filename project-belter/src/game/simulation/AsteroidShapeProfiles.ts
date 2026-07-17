import type { AsteroidEntity } from './components';
import { generatedAsteroidShapeProfiles } from './AsteroidShapeProfiles.generated';
import { normalize, rotate, type Vector2 } from './Vector2';

const getProfile = (asteroid: AsteroidEntity): readonly Vector2[] => {
  const resolution = asteroid.sizeClass === 'very-large' ? 'colossal' : 'standard';
  return generatedAsteroidShapeProfiles[resolution][asteroid.materialClass][asteroid.shapeClass];
};

export const getAsteroidLocalContour = (asteroid: AsteroidEntity, padding = 0): Vector2[] => {
  const radius = asteroid.radius + padding;
  return getProfile(asteroid).map((point) => ({
    x: point.x * radius,
    y: point.y * radius,
  }));
};

/** Distance from the asteroid centre to its alpha-fitted boundary in a world-space direction. */
export const getAsteroidSupportRadius = (
  asteroid: AsteroidEntity,
  worldDirection: Vector2,
): number => {
  const localDirection = rotate(normalize(worldDirection), -asteroid.transform.heading);
  const profile = getProfile(asteroid);
  let angle = Math.atan2(localDirection.y, localDirection.x);
  if (angle < 0) {
    angle += Math.PI * 2;
  }
  const profilePosition = angle / (Math.PI * 2) * profile.length;
  const firstIndex = Math.floor(profilePosition) % profile.length;
  const secondIndex = (firstIndex + 1) % profile.length;
  const blend = profilePosition - Math.floor(profilePosition);
  const first = profile[firstIndex];
  const second = profile[secondIndex];
  if (first === undefined || second === undefined) {
    return asteroid.radius;
  }
  const firstRadius = Math.hypot(first.x, first.y);
  const secondRadius = Math.hypot(second.x, second.y);
  const normalizedRadius = firstRadius + (secondRadius - firstRadius) * blend;
  return asteroid.radius * Math.max(0.25, normalizedRadius);
};
