import type { Tuning } from '../../config/tuning';
import { calculateCargoMass } from '../../../progression/CareerState';
import { hardpointIds, type AsteroidEntity, type DroneEntity, type EntityId, type HardpointId, type ShipEntity } from '../components';
import { getAsteroidSupportRadius } from '../AsteroidShapeProfiles';
import { getShipSupportRadius } from '../ShipShapeProfile';
import { getShipLocalCargoBayAnchor, getShipLocalHardpointAnchor } from '../ShipShapeProfile';
import type { EntityStore } from '../EntityStore';
import type { SimulationEvent } from '../events';
import {
  add,
  distance,
  headingFromVector,
  length,
  moveTowards,
  rotate,
  scale,
  subtract,
  vector,
} from '../Vector2';

export type MiningStatus = 'idle' | 'not-ready' | 'stabilizing' | 'launching' | 'mining' | 'paused' | 'recalling' | 'depleted';

export interface MiningTelemetry {
  status: MiningStatus;
  stableSeconds: number;
  stableProgress: number;
  surfaceDistance: number | null;
  relativeSpeed: number | null;
  activeDrones: number;
  suppressed: boolean;
}

interface MiningCallbacks {
  emit: (event: SimulationEvent) => void;
  spawnDebris: (asteroid: AsteroidEntity) => void;
}

export class MiningSystem {
  private statusValue: MiningStatus = 'idle';
  private stableSecondsValue = 0;
  private targetAsteroidId: EntityId | null = null;
  private debrisSeconds = 0;
  private autoMiningSuppressed = false;

  public constructor(private readonly config: Tuning) {}

  public reset(): void {
    this.statusValue = 'idle';
    this.stableSecondsValue = 0;
    this.targetAsteroidId = null;
    this.debrisSeconds = 0;
    this.autoMiningSuppressed = false;
  }

  public onTargetChanged(targetAsteroidId: EntityId | null, entities: EntityStore): void {
    if (this.targetAsteroidId !== targetAsteroidId && entities.drones.size > 0) {
      this.requestRecall(entities);
    }
    this.targetAsteroidId = targetAsteroidId;
    this.stableSecondsValue = 0;
    this.autoMiningSuppressed = false;
  }

  public requestRecall(entities: EntityStore): void {
    this.autoMiningSuppressed = true;
    this.stableSecondsValue = 0;
    for (const drone of entities.drones.values()) {
      drone.state = 'returning';
    }
    if (entities.drones.size > 0) {
      this.setStatus('recalling');
    }
  }

  public update(
    entities: EntityStore,
    ship: ShipEntity,
    selectedAsteroid: AsteroidEntity | null,
    deltaSeconds: number,
    tick: number,
    callbacks: MiningCallbacks,
  ): void {
    if (selectedAsteroid === null || selectedAsteroid.id !== this.targetAsteroidId) {
      this.onTargetChanged(selectedAsteroid?.id ?? null, entities);
    }

    const geometry = selectedAsteroid === null ? null : this.getGeometry(ship, selectedAsteroid);
    const cargoReserved = this.getReservedCargo(entities.drones.values());
    const cargoSpace = ship.cargoCapacity - ship.cargoMass - cargoReserved;
    const activeDrones = entities.drones.size;

    if (activeDrones === 0) {
      this.updateArming(
        entities,
        ship,
        selectedAsteroid,
        geometry,
        cargoSpace,
        tick,
        callbacks,
      );
    } else {
      this.updateActiveOperation(
        entities,
        selectedAsteroid,
        geometry,
        deltaSeconds,
        tick,
        callbacks,
      );
    }

    this.updateDrones(entities, ship, deltaSeconds, tick, callbacks);

    if (entities.drones.size === 0 && activeDrones > 0) {
      this.debrisSeconds = 0;
      this.stableSecondsValue = 0;
      if (selectedAsteroid?.remainingYield === 0) {
        this.setStatus('depleted', tick, callbacks.emit);
      } else if (this.autoMiningSuppressed) {
        this.setStatus('idle', tick, callbacks.emit);
      }
    }
  }

  public getTelemetry(ship: ShipEntity, asteroid: AsteroidEntity | null): MiningTelemetry {
    const geometry = asteroid === null ? null : this.getGeometry(ship, asteroid);
    return {
      status: this.statusValue,
      stableSeconds: this.stableSecondsValue,
      stableProgress: Math.min(1, this.stableSecondsValue / this.config.mining.armSeconds),
      surfaceDistance: geometry?.surfaceDistance ?? null,
      relativeSpeed: geometry?.relativeSpeed ?? null,
      activeDrones: 0,
      suppressed: this.autoMiningSuppressed,
    };
  }

  private updateArming(
    entities: EntityStore,
    ship: ShipEntity,
    asteroid: AsteroidEntity | null,
    geometry: { surfaceDistance: number; relativeSpeed: number } | null,
    cargoSpace: number,
    tick: number,
    callbacks: MiningCallbacks,
  ): void {
    if (asteroid === null) {
      this.stableSecondsValue = 0;
      this.setStatus('idle', tick, callbacks.emit);
      return;
    }
    if (asteroid.resourceType === 'none') {
      this.stableSecondsValue = 0;
      this.setStatus('not-ready', tick, callbacks.emit);
      return;
    }
    if (asteroid.remainingYield <= 0) {
      this.stableSecondsValue = 0;
      this.setStatus('depleted', tick, callbacks.emit);
      return;
    }
    const hasResources = cargoSpace > 0.05;
    const hasDrone = ship.dronesAboard > 0;
    const safe = geometry !== null
      && geometry.surfaceDistance <= this.config.mining.distanceFromSurface
      && geometry.relativeSpeed < this.config.mining.armRelativeSpeed;

    if (!safe || !hasResources || !hasDrone || this.autoMiningSuppressed) {
      this.stableSecondsValue = 0;
      this.setStatus('not-ready', tick, callbacks.emit);
      return;
    }

    this.stableSecondsValue += 1 / this.config.simulationHz;
    this.setStatus('stabilizing', tick, callbacks.emit);
    if (this.stableSecondsValue >= this.config.mining.armSeconds) {
      this.launchDrones(entities, ship, asteroid, tick, callbacks.emit);
      this.stableSecondsValue = 0;
    }
  }

  private updateActiveOperation(
    entities: EntityStore,
    asteroid: AsteroidEntity | null,
    geometry: { surfaceDistance: number; relativeSpeed: number } | null,
    deltaSeconds: number,
    tick: number,
    callbacks: MiningCallbacks,
  ): void {
    if (asteroid === null || geometry === null) {
      this.requestRecall(entities);
      this.setStatus('recalling', tick, callbacks.emit);
      return;
    }

    const dangerous = geometry.surfaceDistance > this.config.mining.pauseDistance
      || geometry.relativeSpeed >= this.config.mining.emergencyRecallSpeed;
    const outsideEnvelope = geometry.surfaceDistance > this.config.mining.distanceFromSurface
      || geometry.relativeSpeed >= this.config.mining.armRelativeSpeed;

    if (dangerous) {
      this.requestRecall(entities);
      this.setStatus('recalling', tick, callbacks.emit);
      return;
    }

    if (outsideEnvelope) {
      for (const drone of entities.drones.values()) {
        if (drone.state === 'extracting') {
          drone.state = 'paused';
        }
      }
      this.setStatus('paused', tick, callbacks.emit);
      return;
    }

    for (const drone of entities.drones.values()) {
      if (drone.state === 'paused') {
        drone.state = 'extracting';
      }
    }
    const launching = [...entities.drones.values()].some((drone) => drone.state === 'launching');
    this.setStatus(launching ? 'launching' : 'mining', tick, callbacks.emit);
    this.debrisSeconds += deltaSeconds;
    if (this.debrisSeconds >= this.config.mining.debrisIntervalSeconds) {
      this.debrisSeconds -= this.config.mining.debrisIntervalSeconds;
      callbacks.spawnDebris(asteroid);
    }
  }

  private updateDrones(
    entities: EntityStore,
    ship: ShipEntity,
    deltaSeconds: number,
    tick: number,
    callbacks: MiningCallbacks,
  ): void {
    for (const [id, drone] of entities.drones) {
      const asteroid = entities.asteroids.get(drone.targetAsteroidId) ?? null;
      drone.transform.previousPosition = { ...drone.transform.position };
      drone.transform.previousHeading = drone.transform.heading;

      const lostMiningTarget = asteroid === null
        && (drone.state === 'launching' || drone.state === 'extracting' || drone.state === 'paused');
      if (drone.state === 'returning' || lostMiningTarget) {
        const cargoBay = this.getShipAnchor(ship, 'cargo');
        this.moveDroneTowards(drone, cargoBay, deltaSeconds);
        if (distance(drone.transform.position, cargoBay) <= 0.8) {
          drone.state = 'unloading';
          drone.unloadSeconds = 0;
          this.deliverDroneCargo(drone, ship, tick, callbacks.emit);
          drone.carriedAmount = 0;
        }
        continue;
      }

      if (drone.state === 'unloading') {
        drone.transform.position = this.getShipAnchor(ship, 'cargo');
        drone.transform.heading = ship.transform.heading;
        drone.unloadSeconds += deltaSeconds;
        if (drone.unloadSeconds < 0.55) {
          continue;
        }
        const canContinue = !this.autoMiningSuppressed
          && asteroid !== null
          && asteroid.resourceType !== 'none'
          && asteroid.remainingYield > 0.01
          && ship.cargoMass < ship.cargoCapacity - 0.05;
        if (canContinue) {
          drone.state = 'launching';
          drone.extractionSeconds = 0;
          drone.launchDelaySeconds = 0;
        } else {
          drone.state = 'berthing';
        }
        continue;
      }

      if (drone.state === 'berthing') {
        const hardpoint = this.getShipAnchor(ship, drone.assignedHardpoint);
        this.moveDroneTowards(drone, hardpoint, deltaSeconds);
        if (distance(drone.transform.position, hardpoint) <= 0.55) {
          entities.drones.delete(id);
          ship.dronesAboard = Math.min(ship.maxDrones, ship.dronesAboard + 1);
        }
        continue;
      }

      if (asteroid === null) {
        drone.state = 'returning';
        continue;
      }

      const surfacePoint = this.getSurfacePoint(asteroid, drone.surfaceAngle);
      if (drone.launchDelaySeconds > 0) {
        drone.launchDelaySeconds = Math.max(0, drone.launchDelaySeconds - deltaSeconds);
        continue;
      }

      if (drone.state === 'launching') {
        const previous = { ...drone.transform.position };
        drone.transform.position = moveTowards(
          drone.transform.position,
          surfacePoint,
          this.config.mining.droneTravelSpeed * deltaSeconds,
        );
        const motion = subtract(drone.transform.position, previous);
        if (length(motion) > 0.001) {
          drone.transform.heading = headingFromVector(motion);
        }
        if (distance(drone.transform.position, surfacePoint) <= 0.55) {
          drone.state = 'extracting';
          drone.extractionSeconds = 0;
        }
        continue;
      }

      drone.transform.position = surfacePoint;
      drone.transform.heading = asteroid.transform.heading + drone.surfaceAngle + Math.PI / 2;
      if (drone.state === 'paused') {
        continue;
      }

      drone.extractionSeconds += deltaSeconds;
      if (drone.extractionSeconds >= this.config.mining.extractSeconds) {
        this.finishExtraction(drone, asteroid, ship, entities, tick, callbacks);
      }
    }
  }

  private finishExtraction(
    drone: DroneEntity,
    asteroid: AsteroidEntity,
    ship: ShipEntity,
    entities: EntityStore,
    tick: number,
    callbacks: MiningCallbacks,
  ): void {
    if (asteroid.resourceType === 'none') {
      drone.state = 'returning';
      drone.carriedAmount = 0;
      return;
    }
    const reserved = this.getReservedCargo(entities.drones.values());
    const space = Math.max(0, ship.cargoCapacity - ship.cargoMass - reserved);
    const amount = Math.min(
      this.config.mining.payloadPerTrip,
      asteroid.remainingYield,
      space,
    );
    if (amount <= 0.01) {
      drone.state = 'returning';
      drone.carriedAmount = 0;
      return;
    }

    asteroid.remainingYield = Math.max(0, asteroid.remainingYield - amount);
    drone.carriedResource = asteroid.resourceType;
    drone.carriedAmount = amount;
    drone.state = 'returning';
    callbacks.spawnDebris(asteroid);
    if (asteroid.remainingYield <= 0.001) {
      asteroid.remainingYield = 0;
      callbacks.emit({ type: 'AsteroidDepleted', tick, asteroidId: asteroid.id });
    }
  }

  private launchDrones(
    entities: EntityStore,
    ship: ShipEntity,
    asteroid: AsteroidEntity,
    tick: number,
    emit: (event: SimulationEvent) => void,
  ): void {
    if (asteroid.resourceType === 'none') {
      return;
    }
    const droneHardpoints = hardpointIds.filter((hardpoint) => {
      const equipment = ship.hardpoints[hardpoint];
      return equipment.moduleId === 'mining-drone'
        && equipment.condition > 0
        && ![...entities.drones.values()].some((drone) => drone.assignedHardpoint === hardpoint);
    });
    const launchCount = Math.min(ship.dronesAboard, droneHardpoints.length);
    const baseAngle = Math.atan2(
      ship.transform.position.y - asteroid.transform.position.y,
      ship.transform.position.x - asteroid.transform.position.x,
    );
    for (let index = 0; index < launchCount; index += 1) {
      const offset = (index - (launchCount - 1) / 2) * 0.42;
      const assignedHardpoint = droneHardpoints[index];
      if (assignedHardpoint === undefined) {
        continue;
      }
      const position = this.getShipAnchor(ship, assignedHardpoint);
      const drone = entities.addDrone({
        kind: 'drone',
        transform: {
          position,
          previousPosition: { ...position },
          heading: ship.transform.heading,
          previousHeading: ship.transform.heading,
        },
        velocity: { linear: vector(), angular: 0 },
        collider: { radius: 1.3 },
        droneIndex: index,
        spriteIndex: index % 4,
        state: 'launching',
        targetAsteroidId: asteroid.id,
        surfaceAngle: baseAngle + offset,
        extractionSeconds: 0,
        carriedResource: asteroid.resourceType,
        carriedAmount: 0,
        launchDelaySeconds: index * this.config.mining.launchSpacingSeconds,
        assignedHardpoint,
        unloadSeconds: 0,
      });
      ship.dronesAboard -= 1;
      emit({ type: 'DroneLaunched', tick, droneId: drone.id });
    }
    this.setStatus('launching', tick, emit);
  }

  private moveDroneTowards(drone: DroneEntity, destination: { x: number; y: number }, deltaSeconds: number): void {
    const previous = { ...drone.transform.position };
    drone.transform.position = moveTowards(
      drone.transform.position,
      destination,
      this.config.mining.droneTravelSpeed * deltaSeconds,
    );
    const motion = subtract(drone.transform.position, previous);
    if (length(motion) > 0.001) {
      drone.transform.heading = headingFromVector(motion);
    }
  }

  private getShipAnchor(ship: ShipEntity, anchor: HardpointId | 'cargo'): { x: number; y: number } {
    const local = anchor === 'cargo'
      ? getShipLocalCargoBayAnchor()
      : getShipLocalHardpointAnchor(anchor);
    return add(ship.transform.position, rotate(local, ship.transform.heading));
  }

  private deliverDroneCargo(
    drone: DroneEntity,
    ship: ShipEntity,
    tick: number,
    emit: (event: SimulationEvent) => void,
  ): void {
    if (drone.carriedAmount <= 0) {
      return;
    }
    ship.cargo[drone.carriedResource] += drone.carriedAmount;
    ship.cargoMass = calculateCargoMass(ship.cargo);
    emit({
      type: 'CargoDelivered',
      tick,
      resource: drone.carriedResource,
      amount: drone.carriedAmount,
    });
  }

  private getGeometry(ship: ShipEntity, asteroid: AsteroidEntity): { surfaceDistance: number; relativeSpeed: number } {
    const centreOffset = subtract(ship.transform.position, asteroid.transform.position);
    const centreDistance = length(centreOffset);
    const direction = centreDistance > 0.001
      ? scale(centreOffset, 1 / centreDistance)
      : vector(1, 0);
    return {
      surfaceDistance: Math.max(
        0,
        centreDistance
          - getShipSupportRadius(ship, scale(direction, -1))
          - getAsteroidSupportRadius(asteroid, direction),
      ),
      relativeSpeed: length(subtract(ship.velocity.linear, asteroid.velocity.linear)),
    };
  }

  private getSurfacePoint(asteroid: AsteroidEntity, surfaceAngle: number): { x: number; y: number } {
    const angle = surfaceAngle + asteroid.transform.heading;
    const direction = vector(Math.cos(angle), Math.sin(angle));
    return add(
      asteroid.transform.position,
      scale(direction, getAsteroidSupportRadius(asteroid, direction) + 1.6),
    );
  }

  private getReservedCargo(drones: Iterable<DroneEntity>): number {
    let reserved = 0;
    for (const drone of drones) {
      reserved += drone.carriedAmount;
    }
    return reserved;
  }

  private setStatus(
    status: MiningStatus,
    tick?: number,
    emit?: (event: SimulationEvent) => void,
  ): void {
    if (status === this.statusValue) {
      return;
    }
    this.statusValue = status;
    if (tick !== undefined && emit !== undefined) {
      emit({ type: 'MiningStateChanged', tick, status });
    }
  }
}
