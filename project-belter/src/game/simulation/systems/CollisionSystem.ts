import type { Tuning } from '../../config/tuning';
import type { AsteroidEntity, DebrisEntity, ShipEntity, TraderEntity } from '../components';
import type { SimulationEvent } from '../events';
import { dot, length, scale, subtract, vector } from '../Vector2';
import { getAsteroidSupportRadius } from '../AsteroidShapeProfiles';
import { getShipSupportRadius } from '../ShipShapeProfile';
import { calculateCollisionDamage } from './DamageSystem';

type CollisionObject = AsteroidEntity | DebrisEntity | TraderEntity;

export class CollisionSystem {
  private readonly activeContacts = new Set<string>();

  public constructor(private readonly config: Tuning) {}

  public update(
    ship: ShipEntity,
    asteroids: Iterable<AsteroidEntity>,
    traders: Iterable<TraderEntity>,
    debris: Map<number, DebrisEntity>,
    tick: number,
    emit: (event: SimulationEvent) => void,
  ): void {
    for (const asteroid of asteroids) {
      this.resolveContact(ship, asteroid, tick, emit, false);
    }
    for (const trader of traders) {
      this.resolveContact(ship, trader, tick, emit, false);
    }
    for (const [id, fragment] of debris) {
      const collided = this.resolveContact(ship, fragment, tick, emit, true);
      if (collided) {
        debris.delete(id);
      }
    }
  }

  public reset(): void {
    this.activeContacts.clear();
  }

  private resolveContact(
    ship: ShipEntity,
    object: CollisionObject,
    tick: number,
    emit: (event: SimulationEvent) => void,
    removeOnImpact: boolean,
  ): boolean {
    if (object.kind === 'asteroid' && object.collisionGraceSeconds > 0) {
      return false;
    }
    const contactKey = `${object.kind}:${object.id}`;
    const separation = subtract(ship.transform.position, object.transform.position);
    const centreDistance = length(separation);
    const normal = centreDistance > 0.0001 ? scale(separation, 1 / centreDistance) : vector(1, 0);
    const objectRadius = object.kind === 'asteroid'
      ? getAsteroidSupportRadius(object, normal)
      : object.kind === 'trader'
        ? getShipSupportRadius(object, normal)
      : object.collider.radius;
    const shipRadius = getShipSupportRadius(ship, scale(normal, -1));
    const minimumDistance = shipRadius + objectRadius;
    const rearmDistance = minimumDistance + this.config.collisionRearmDistance;

    if (centreDistance > rearmDistance) {
      this.activeContacts.delete(contactKey);
      return false;
    }
    if (centreDistance >= minimumDistance) {
      return false;
    }

    if (this.activeContacts.has(contactKey)) {
      return false;
    }
    this.activeContacts.add(contactKey);

    const relativeVelocity = subtract(ship.velocity.linear, object.velocity.linear);
    const relativeSpeed = length(relativeVelocity);

    // Sub-threshold objects pass harmlessly through the ship. Small debris is consumed
    // without moving the ship; gentle asteroid contact produces no response at all.
    if (relativeSpeed < this.config.safeContactSpeed) {
      return removeOnImpact;
    }

    const penetration = minimumDistance - centreDistance;
    ship.transform.position.x += normal.x * penetration;
    ship.transform.position.y += normal.y * penetration;

    const normalRelativeSpeed = dot(relativeVelocity, normal);
    const closingSpeed = Math.max(0, -normalRelativeSpeed);

    if (normalRelativeSpeed < 0) {
      const restitution = removeOnImpact ? 0.08 : this.config.ship.collisionRestitution;
      const impulseScale = -(1 + restitution) * normalRelativeSpeed;
      ship.velocity.linear.x += normal.x * impulseScale;
      ship.velocity.linear.y += normal.y * impulseScale;
    }

    const effectiveRadius = object.kind === 'debris'
      ? Math.max(4, object.collider.radius * 2.2)
      : object.kind === 'asteroid'
        ? object.radius
        : object.collider.radius;
    const damageResult = calculateCollisionDamage(
      closingSpeed,
      effectiveRadius,
      this.config.safeContactSpeed,
      this.config.minorDamageSpeed,
      this.config.seriousDamageSpeed,
    );
    const impactAngleFactor = relativeSpeed > 0.001
      ? 0.55 + 0.45 * (closingSpeed / relativeSpeed)
      : 0;
    const debrisFactor = object.kind === 'debris' ? 0.58 : 1;
    const damage = Math.min(
      this.config.ship.maxCollisionDamage,
      damageResult.damage * impactAngleFactor * debrisFactor,
    );
    ship.hull = Math.max(0, ship.hull - damage);

    emit({
      type: 'CollisionOccurred',
      tick,
      objectId: object.id,
      objectKind: object.kind,
      relativeSpeed,
      closingSpeed,
      damage,
      severity: damageResult.severity,
      normal,
    });
    if (ship.hull <= 0) {
      emit({ type: 'ShipDisabled', tick });
    }
    return removeOnImpact;
  }
}
