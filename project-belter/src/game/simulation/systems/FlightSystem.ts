import type { FlightActionState } from '../../input/InputActions';
import type { Tuning } from '../../config/tuning';
import type { ShipEntity } from '../components';
import { add, clampMagnitude, forwardFromHeading, rightFromHeading, scale, wrapAngle } from '../Vector2';

export class FlightSystem {
  public constructor(private readonly config: Tuning) {}

  public update(ship: ShipEntity, actions: FlightActionState, deltaSeconds: number): void {
    ship.transform.previousPosition = { ...ship.transform.position };
    ship.transform.previousHeading = ship.transform.heading;

    const steer = Math.min(1, Math.max(-1, actions.steer));
    const requestedForward = Math.min(1, Math.max(0, actions.thrustForward));
    const requestedReverse = Math.min(1, Math.max(0, actions.thrustReverse));
    const requestedStrafe = Math.min(1, Math.max(-1, actions.strafe));
    const hasFuel = ship.fuel > 0;
    const mainForwardInput = hasFuel ? requestedForward : 0;
    const reverseInput = hasFuel ? requestedReverse : 0;
    const strafeInput = requestedStrafe;
    const steerInput = steer;

    ship.velocity.angular += steerInput * ship.rotationalAcceleration * deltaSeconds;
    const angularDamping = Math.exp(-this.config.ship.angularDamping * deltaSeconds);
    ship.velocity.angular *= angularDamping;
    ship.velocity.angular = Math.min(
      ship.maxAngularSpeed,
      Math.max(-ship.maxAngularSpeed, ship.velocity.angular),
    );
    ship.transform.heading = wrapAngle(
      ship.transform.heading + ship.velocity.angular * deltaSeconds,
    );

    const mass = Math.max(0.001, ship.dryMass + ship.cargoMass);
    const auxiliaryForwardForce = this.config.ship.auxiliaryForwardThrust * requestedForward;
    const mainForwardForce = Math.max(
      0,
      ship.forwardThrust - this.config.ship.auxiliaryForwardThrust,
    ) * mainForwardInput;
    const netForce = auxiliaryForwardForce + mainForwardForce - ship.reverseThrust * reverseInput;
    const acceleration = add(
      scale(forwardFromHeading(ship.transform.heading), netForce / mass),
      scale(rightFromHeading(ship.transform.heading), this.config.ship.lateralThrust * strafeInput / mass),
    );

    ship.velocity.linear.x += acceleration.x * deltaSeconds;
    ship.velocity.linear.y += acceleration.y * deltaSeconds;
    ship.velocity.linear = clampMagnitude(
      ship.velocity.linear,
      this.config.ship.internalSafetySpeedClamp,
    );

    ship.transform.position.x += ship.velocity.linear.x * deltaSeconds;
    ship.transform.position.y += ship.velocity.linear.y * deltaSeconds;

    const fuelUse = (
      mainForwardInput * this.config.ship.forwardFuelPerSecond
      + reverseInput * this.config.ship.reverseFuelPerSecond
      + Math.abs(strafeInput) * this.config.ship.lateralFuelPerSecond
      + Math.abs(steerInput) * this.config.ship.rotationalFuelPerSecond
    ) * ship.fuelUseMultiplier;
    ship.fuel = Math.max(0, ship.fuel - fuelUse * deltaSeconds);
  }
}
