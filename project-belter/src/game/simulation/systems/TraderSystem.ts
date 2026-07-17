import type { Tuning } from '../../config/tuning';
import type { AsteroidEntity, StationEntity, TraderEntity } from '../components';
import {
  add,
  distance,
  headingFromVector,
  length,
  moveTowards,
  normalize,
  scale,
  subtract,
  vector,
  type Vector2,
} from '../Vector2';
import { AutopilotSystem, type AutopilotObstacle } from './AutopilotSystem';

export class TraderSystem {
  private readonly planner: AutopilotSystem;

  public constructor(private readonly config: Tuning) {
    this.planner = new AutopilotSystem(config);
  }

  public reset(): void {
    this.planner.reset();
  }

  public update(
    trader: TraderEntity,
    stations: ReadonlyMap<number, StationEntity>,
    asteroids: Iterable<AsteroidEntity>,
    deltaSeconds: number,
  ): void {
    trader.transform.previousPosition = { ...trader.transform.position };
    trader.transform.previousHeading = trader.transform.heading;
    const destination = stations.get(trader.destinationStationId);
    if (destination === undefined) {
      trader.velocity.linear = vector();
      return;
    }

    if (trader.state === 'docked') {
      trader.velocity.linear = vector();
      trader.dockingSecondsRemaining -= deltaSeconds;
      if (trader.dockingSecondsRemaining > 0) {
        return;
      }
      trader.state = 'traveling';
      trader.route = [];
      trader.replanSecondsRemaining = 0;
    }

    const obstacles = [...asteroids].map((asteroid): AutopilotObstacle => ({
      id: asteroid.id,
      position: asteroid.transform.position,
      velocity: asteroid.velocity.linear,
      radius: asteroid.collider.radius,
    }));
    const dock = this.getDockPosition(destination);
    trader.replanSecondsRemaining -= deltaSeconds;
    if (
      trader.route.length === 0
      || trader.replanSecondsRemaining <= 0
      || !this.planner.isPathClear(trader.transform.position, trader.route, obstacles)
    ) {
      trader.route = this.planner.plan(trader.transform.position, dock, obstacles);
      trader.replanSecondsRemaining = this.config.trader.replanSeconds;
    }

    while (
      trader.route.length > 1
      && distance(trader.transform.position, trader.route[0] as Vector2)
        <= this.config.trader.waypointTolerance
    ) {
      trader.route.shift();
    }

    const waypoint = trader.route[0] ?? dock;
    const toWaypoint = subtract(waypoint, trader.transform.position);
    const remaining = distance(trader.transform.position, dock);
    const desiredSpeed = Math.min(
      this.config.trader.cruiseSpeed,
      Math.sqrt(Math.max(0, remaining) * this.config.trader.acceleration),
    );
    const desiredVelocity = length(toWaypoint) > 0.001
      ? scale(normalize(toWaypoint), desiredSpeed)
      : vector();
    trader.velocity.linear = moveTowards(
      trader.velocity.linear,
      desiredVelocity,
      this.config.trader.acceleration * deltaSeconds,
    );
    trader.transform.position = add(
      trader.transform.position,
      scale(trader.velocity.linear, deltaSeconds),
    );
    if (length(trader.velocity.linear) > 0.05) {
      trader.transform.heading = headingFromVector(trader.velocity.linear);
    }

    const arrivalDistance = distance(trader.transform.position, dock);
    if (arrivalDistance <= this.config.trader.arrivalRadius && length(trader.velocity.linear) <= 2) {
      trader.transform.position = { ...dock };
      trader.transform.previousPosition = { ...dock };
      trader.velocity.linear = vector();
      trader.state = 'docked';
      trader.currentStationId = destination.id;
      const nextDestination = [...stations.values()].find((station) => station.id !== destination.id);
      trader.destinationStationId = nextDestination?.id ?? destination.id;
      trader.dockingSecondsRemaining = this.config.trader.dockingSeconds;
      trader.route = [];
      trader.replanSecondsRemaining = 0;
    }
  }

  public getDockPosition(station: StationEntity): Vector2 {
    const direction = station.destinationId === 'ceres-relay' ? 1 : -1;
    return add(station.transform.position, vector(
      direction * this.config.trader.dockLateralOffset,
      0,
    ));
  }
}
