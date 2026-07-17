import type { Tuning } from '../../config/tuning';
import { neutralFlightActions, type FlightActionState } from '../../input/InputActions';
import type { ShipEntity } from '../components';
import {
  add,
  dot,
  forwardFromHeading,
  headingFromVector,
  length,
  normalize,
  rightFromHeading,
  scale,
  subtract,
  vector,
  wrapAngle,
  type Vector2,
} from '../Vector2';

export interface NavigationTarget {
  kind: 'asteroid' | 'station' | 'trader' | 'waypoint';
  position: Vector2;
  velocity: Vector2;
  radius: number;
  maximumSpeed?: number;
  arrivalRadius?: number;
  transit?: boolean;
}

export interface NavigationResolution {
  actions: FlightActionState;
  manualOverride: boolean;
  mode: 'manual' | 'approach';
  desiredVelocity: Vector2;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export class NavigationSystem {
  public constructor(private readonly config: Tuning) {}

  public resolve(
    ship: ShipEntity,
    manualActions: FlightActionState,
    target: NavigationTarget | null,
    approachEnabled: boolean,
  ): NavigationResolution {
    const directMagnitude = Math.max(
      Math.abs(manualActions.steer),
      Math.abs(manualActions.strafe),
      manualActions.thrustForward,
      manualActions.thrustReverse,
    );
    const manualOverride = directMagnitude > this.config.navigation.directOverrideThreshold;
    if (target === null || manualOverride || !approachEnabled) {
      return {
        actions: { ...manualActions },
        manualOverride,
        mode: 'manual',
        desiredVelocity: { ...ship.velocity.linear },
      };
    }

    const desiredVelocity = this.getApproachVelocity(ship, target);
    const deltaVelocity = subtract(desiredVelocity, ship.velocity.linear);
    const deltaSpeed = length(deltaVelocity);
    const assisted = neutralFlightActions();

    if (deltaSpeed < 0.06) {
      return {
        actions: assisted,
        manualOverride: false,
        mode: 'approach',
        desiredVelocity,
      };
    }

    const forwardHeading = headingFromVector(deltaVelocity);
    const reverseHeading = wrapAngle(forwardHeading + Math.PI);
    const forwardError = wrapAngle(forwardHeading - ship.transform.heading);
    const reverseError = wrapAngle(reverseHeading - ship.transform.heading);
    const useReverse = Math.abs(reverseError) + 0.2 < Math.abs(forwardError) && deltaSpeed < 8;
    const headingError = useReverse ? reverseError : forwardError;

    assisted.steer = clamp(
      headingError * this.config.navigation.headingGain
        - ship.velocity.angular * this.config.navigation.angularVelocityGain,
      -1,
      1,
    );

    const lateralDelta = dot(deltaVelocity, rightFromHeading(ship.transform.heading));
    assisted.strafe = clamp(
      lateralDelta / this.config.navigation.thrustDeltaVForFullInput,
      -1,
      1,
    );

    if (Math.abs(headingError) < 0.58) {
      const forwardDelta = dot(deltaVelocity, forwardFromHeading(ship.transform.heading));
      const thrust = clamp(
        Math.abs(forwardDelta) / this.config.navigation.thrustDeltaVForFullInput,
        0.08,
        1,
      );
      if (useReverse || forwardDelta < 0) {
        assisted.thrustReverse = thrust;
      } else {
        assisted.thrustForward = thrust;
      }
    }

    return {
      actions: assisted,
      manualOverride: false,
      mode: 'approach',
      desiredVelocity,
    };
  }

  private getApproachVelocity(ship: ShipEntity, target: NavigationTarget): Vector2 {
    const navigation = this.config.navigation;
    const targetToShip = subtract(ship.transform.position, target.position);
    const away = length(targetToShip) > 0.001 ? normalize(targetToShip) : vector(0, -1);
    const surfaceStandOff = target.kind === 'station'
      ? navigation.stationStandoffSurface
      : target.kind === 'asteroid' || target.kind === 'trader'
        ? navigation.asteroidStandoffSurface
        : 0;
    const desiredPoint = target.kind === 'station'
      ? add(target.position, vector(0, -(target.radius + ship.collider.radius + surfaceStandOff)))
      : target.kind === 'asteroid' || target.kind === 'trader'
        ? add(target.position, scale(away, target.radius + ship.collider.radius + surfaceStandOff))
        : target.position;
    const positionError = subtract(desiredPoint, ship.transform.position);
    const distanceError = length(positionError);
    const arrivalRadius = target.arrivalRadius ?? 0.15;

    if (distanceError < arrivalRadius) {
      return { ...target.velocity };
    }

    const direction = normalize(positionError);
    const maximumSpeed = target.maximumSpeed ?? navigation.maximumApproachSpeed;
    const speedFromDistance = Math.sqrt(Math.max(0, distanceError) * 2.2);
    const approachSpeed = target.transit
      ? maximumSpeed
      : distanceError < 12
      ? Math.min(navigation.finalApproachSpeed, distanceError * 0.28)
      : Math.min(maximumSpeed, speedFromDistance);
    return add(target.velocity, scale(direction, approachSpeed));
  }
}
