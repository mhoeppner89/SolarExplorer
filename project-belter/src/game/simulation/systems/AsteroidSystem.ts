import type { Tuning } from '../../config/tuning';
import type { AsteroidEntity } from '../components';
import { wrapAngle } from '../Vector2';

export class AsteroidSystem {
  public constructor(private readonly config: Tuning) {}

  public update(asteroids: Iterable<AsteroidEntity>, deltaSeconds: number): void {
    for (const asteroid of asteroids) {
      asteroid.collisionGraceSeconds = Math.max(0, asteroid.collisionGraceSeconds - deltaSeconds);
      asteroid.transform.previousPosition = { ...asteroid.transform.position };
      asteroid.transform.previousHeading = asteroid.transform.heading;
      asteroid.transform.position.x += asteroid.velocity.linear.x * deltaSeconds;
      asteroid.transform.position.y += asteroid.velocity.linear.y * deltaSeconds;
      asteroid.transform.heading = wrapAngle(
        asteroid.transform.heading + asteroid.velocity.angular * deltaSeconds,
      );
      this.wrapAsteroid(asteroid);
    }
  }

  private wrapAsteroid(asteroid: AsteroidEntity): void {
    const extent = this.config.sectorHalfExtent;
    const span = extent * 2;
    if (asteroid.transform.position.x < -extent) {
      asteroid.transform.position.x += span;
      asteroid.transform.previousPosition.x += span;
    } else if (asteroid.transform.position.x > extent) {
      asteroid.transform.position.x -= span;
      asteroid.transform.previousPosition.x -= span;
    }
    if (asteroid.transform.position.y < -extent) {
      asteroid.transform.position.y += span;
      asteroid.transform.previousPosition.y += span;
    } else if (asteroid.transform.position.y > extent) {
      asteroid.transform.position.y -= span;
      asteroid.transform.previousPosition.y -= span;
    }
  }
}
