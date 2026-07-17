import type { Tuning } from '../../config/tuning';
import type { DebrisEntity, EntityId } from '../components';
import { wrapAngle } from '../Vector2';

export class DebrisSystem {
  public constructor(private readonly config: Tuning) {}

  public update(debris: Map<EntityId, DebrisEntity>, deltaSeconds: number): void {
    for (const [id, fragment] of debris) {
      fragment.transform.previousPosition = { ...fragment.transform.position };
      fragment.transform.previousHeading = fragment.transform.heading;
      fragment.transform.position.x += fragment.velocity.linear.x * deltaSeconds;
      fragment.transform.position.y += fragment.velocity.linear.y * deltaSeconds;
      fragment.transform.heading = wrapAngle(
        fragment.transform.heading + fragment.velocity.angular * deltaSeconds,
      );
      fragment.lifetimeSeconds -= deltaSeconds;

      const outOfSector = Math.abs(fragment.transform.position.x) > this.config.sectorHalfExtent * 1.25
        || Math.abs(fragment.transform.position.y) > this.config.sectorHalfExtent * 1.25;
      if (fragment.lifetimeSeconds <= 0 || outOfSector) {
        debris.delete(id);
      }
    }
  }
}
