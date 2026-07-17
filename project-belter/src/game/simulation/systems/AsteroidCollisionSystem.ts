import type { Tuning } from '../../config/tuning';
import type { AsteroidEntity, EntityId } from '../components';
import { dot, length, scale, subtract, vector, type Vector2 } from '../Vector2';
import { getAsteroidSupportRadius } from '../AsteroidShapeProfiles';

export interface AsteroidImpact {
  firstId: EntityId;
  secondId: EntityId;
  relativeSpeed: number;
  normal: Vector2;
}

export class AsteroidCollisionSystem {
  private activeContacts = new Set<string>();

  public constructor(private readonly config: Tuning) {}

  public update(asteroids: ReadonlyMap<EntityId, AsteroidEntity>): AsteroidImpact[] {
    const entities = [...asteroids.values()];
    const nextContacts = new Set<string>();
    const impacts: AsteroidImpact[] = [];

    for (let firstIndex = 0; firstIndex < entities.length; firstIndex += 1) {
      const first = entities[firstIndex];
      if (first === undefined) {
        continue;
      }
      if (first.collisionGraceSeconds > 0) {
        continue;
      }
      for (let secondIndex = firstIndex + 1; secondIndex < entities.length; secondIndex += 1) {
        const second = entities[secondIndex];
        if (second === undefined) {
          continue;
        }
        if (second.collisionGraceSeconds > 0) {
          continue;
        }
        const offset = subtract(second.transform.position, first.transform.position);
        const centreDistance = length(offset);
        const normal = centreDistance > 0.0001 ? scale(offset, 1 / centreDistance) : vector(1, 0);
        const minimumDistance = getAsteroidSupportRadius(first, normal)
          + getAsteroidSupportRadius(second, scale(normal, -1));
        if (centreDistance >= minimumDistance) {
          continue;
        }

        const contactKey = first.id < second.id
          ? `${first.id}:${second.id}`
          : `${second.id}:${first.id}`;
        nextContacts.add(contactKey);
        const inverseFirstMass = 1 / Math.max(1, first.radius ** 3);
        const inverseSecondMass = 1 / Math.max(1, second.radius ** 3);
        const inverseMassTotal = inverseFirstMass + inverseSecondMass;
        const penetration = minimumDistance - centreDistance;

        first.transform.position.x -= normal.x * penetration * (inverseFirstMass / inverseMassTotal);
        first.transform.position.y -= normal.y * penetration * (inverseFirstMass / inverseMassTotal);
        second.transform.position.x += normal.x * penetration * (inverseSecondMass / inverseMassTotal);
        second.transform.position.y += normal.y * penetration * (inverseSecondMass / inverseMassTotal);

        const relativeVelocity = subtract(second.velocity.linear, first.velocity.linear);
        const relativeSpeed = length(relativeVelocity);
        const normalSpeed = dot(relativeVelocity, normal);
        if (normalSpeed < 0) {
          const impulse = -(1 + this.config.asteroid.collisionRestitution)
            * normalSpeed
            / inverseMassTotal;
          first.velocity.linear.x -= normal.x * impulse * inverseFirstMass;
          first.velocity.linear.y -= normal.y * impulse * inverseFirstMass;
          second.velocity.linear.x += normal.x * impulse * inverseSecondMass;
          second.velocity.linear.y += normal.y * impulse * inverseSecondMass;
        }

        if (!this.activeContacts.has(contactKey)) {
          impacts.push({
            firstId: first.id,
            secondId: second.id,
            relativeSpeed,
            normal,
          });
        }
      }
    }

    this.activeContacts = nextContacts;
    return impacts;
  }

  public reset(): void {
    this.activeContacts.clear();
  }
}
