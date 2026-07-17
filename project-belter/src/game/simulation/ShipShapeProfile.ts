import type { HardpointId, ShipEntity } from './components';
import {
  generatedShipAnchors,
  generatedShipContour,
  SHIP_DISPLAY_HEIGHT,
  SHIP_DISPLAY_WIDTH,
} from './ShipShapeProfile.generated';
import { normalize, rotate, type Vector2 } from './Vector2';

export { SHIP_DISPLAY_HEIGHT, SHIP_DISPLAY_WIDTH };

export const getShipLocalContour = (): Vector2[] =>
  generatedShipContour.map((point) => ({ ...point }));

/** Distance from the ship centre to the alpha-derived hull boundary. */
export const getShipSupportRadius = (
  ship: Pick<ShipEntity, 'transform' | 'collider'>,
  worldDirection: Vector2,
): number => {
  const localDirection = rotate(normalize(worldDirection), -ship.transform.heading);
  let angle = Math.atan2(localDirection.y, localDirection.x);
  if (angle < 0) {
    angle += Math.PI * 2;
  }
  const profilePosition = angle / (Math.PI * 2) * generatedShipContour.length;
  const firstIndex = Math.floor(profilePosition) % generatedShipContour.length;
  const secondIndex = (firstIndex + 1) % generatedShipContour.length;
  const blend = profilePosition - Math.floor(profilePosition);
  const first = generatedShipContour[firstIndex];
  const second = generatedShipContour[secondIndex];
  if (first === undefined || second === undefined) {
    return ship.collider.radius;
  }
  const firstRadius = Math.hypot(first.x, first.y);
  const secondRadius = Math.hypot(second.x, second.y);
  return firstRadius + (secondRadius - firstRadius) * blend;
};

export const getShipLocalHardpointAnchor = (hardpoint: HardpointId): Vector2 => ({
  ...generatedShipAnchors[hardpoint],
});

export const getShipLocalCargoBayAnchor = (): Vector2 => ({
  ...generatedShipAnchors.cargoBay,
});

