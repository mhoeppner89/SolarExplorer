import type {
  AsteroidResourceType,
  ModuleId,
  ResourceTier,
} from '../../data/gameData';
import { isHardpointModule, resourceDefinitions, resourceTierDefinitions } from '../../data/gameData';
import {
  navigationDestinations,
  type NavigationDestination,
} from '../../data/navigationData';
import { createEmptyCargo, calculateCargoMass, type CargoManifest } from '../../progression/CareerState';
import { aggregateShipStats } from '../../progression/ShipLoadout';
import { tuning, type Tuning } from '../config/tuning';
import type { FlightActionState } from '../input/InputActions';
import { neutralFlightActions } from '../input/InputActions';
import type {
  AsteroidEntity,
  DebrisEntity,
  DroneEntity,
  EntityId,
  HardpointId,
  ShipEntity,
  StationEntity,
  TraderEntity,
} from './components';
import { hardpointIds } from './components';
import { getAsteroidSupportRadius } from './AsteroidShapeProfiles';
import { getShipSupportRadius } from './ShipShapeProfile';
import { EntityStore } from './EntityStore';
import type { SimulationEvent } from './events';
import { SeededRandom } from './SeededRandom';
import {
  add,
  distance,
  dot,
  length,
  lengthSquared,
  lerpAngle,
  lerpVector,
  normalize,
  rotate,
  scale,
  subtract,
  vector,
  type Vector2,
} from './Vector2';
import { AsteroidSystem } from './systems/AsteroidSystem';
import {
  AutopilotSystem,
  type AutopilotStatus,
  type AutopilotTelemetry,
} from './systems/AutopilotSystem';
import { AsteroidCollisionSystem, type AsteroidImpact } from './systems/AsteroidCollisionSystem';
import { CollisionSystem } from './systems/CollisionSystem';
import { DebrisSystem } from './systems/DebrisSystem';
import { FlightSystem } from './systems/FlightSystem';
import { MiningSystem, type MiningStatus } from './systems/MiningSystem';
import { NavigationSystem, type NavigationTarget } from './systems/NavigationSystem';
import { TraderSystem } from './systems/TraderSystem';

export type FlightPhase = 'station' | 'flight' | 'docking' | 'disabled';

export interface TargetReference {
  kind: 'asteroid' | 'station' | 'trader';
  id: EntityId;
}

export interface InterpolatedTransform {
  position: Vector2;
  heading: number;
}

export interface TargetSnapshot {
  kind: 'asteroid' | 'station' | 'trader';
  id: EntityId;
  name: string;
  position: Vector2;
  velocity: Vector2;
  radius: number;
  distanceToSurface: number;
  relativeSpeed: number;
  closingSpeed: number;
  resourceType: AsteroidResourceType | null;
  resourceLabel: string;
  materialClass: AsteroidEntity['materialClass'] | null;
  shapeClass: AsteroidEntity['shapeClass'] | null;
  sizeClass: AsteroidEntity['sizeClass'] | null;
  resourceTier: ResourceTier | null;
  resourceTierLabel: string;
  remainingYield: number | null;
  yieldPercent: number | null;
  stability: number | null;
  structuralIntegrity: number | null;
  maximumStructuralIntegrity: number | null;
  closestApproachDistance: number;
  timeToClosestApproach: number;
}

export interface SimulationDebugSnapshot {
  tick: number;
  elapsedSeconds: number;
  entityCount: number;
  phase: FlightPhase;
  assistEnabled: boolean;
  autopilotAvailable: boolean;
  assistMode: 'manual' | 'approach' | 'autopilot';
  desiredVelocity: Vector2;
  appliedActions: FlightActionState;
  ship: {
    position: Vector2;
    velocity: Vector2;
    speed: number;
    heading: number;
    angularVelocity: number;
    mass: number;
    dryMass: number;
    cargoMass: number;
    cargoCapacity: number;
    cargo: CargoManifest;
    hull: number;
    maxHull: number;
    fuel: number;
    fuelCapacity: number;
    dronesAboard: number;
    dronesDeployed: number;
    maxDrones: number;
    forwardThrust: number;
    reverseThrust: number;
    accelerationPotential: number;
    installedModules: ModuleId[];
    cargoBayActive: boolean;
    hardpoints: Record<HardpointId, {
      moduleId: ModuleId | null;
      condition: number;
      operational: boolean;
      occupied: boolean;
    }>;
  };
  target: TargetSnapshot | null;
  navigationBeacon: {
    id: string;
    kind: NavigationDestination['kind'];
    name: string;
    code: string;
    position: Vector2;
    distance: number;
  } | null;
  autopilot: {
    enabled: boolean;
    status: AutopilotStatus;
    destinationId: string | null;
    remainingDistance: number;
    waypoint: Vector2 | null;
    path: Vector2[];
  };
  dockedStation: {
    id: EntityId;
    destinationId: string;
    name: string;
    code: string;
  };
  traders: Array<{
    id: EntityId;
    name: string;
    code: string;
    state: TraderEntity['state'];
    position: Vector2;
    velocity: Vector2;
    speed: number;
    currentStationId: EntityId;
    destinationStationId: EntityId;
    dockingSecondsRemaining: number;
    route: Vector2[];
  }>;
  trackableAsteroids: Array<{
    id: EntityId;
    name: string;
    code: string;
    position: Vector2;
    velocity: Vector2;
    materialClass: AsteroidEntity['materialClass'];
    resourceType: AsteroidResourceType;
    structuralIntegrity: number;
    maximumStructuralIntegrity: number;
  }>;
  mining: {
    status: MiningStatus;
    stableProgress: number;
    surfaceDistance: number | null;
    relativeSpeed: number | null;
    activeDrones: number;
    suppressed: boolean;
  };
  docking: {
    progress: number;
    eligible: boolean;
  };
  objective: string;
  contextActionLabel: string;
  contextActionEnabled: boolean;
}

export interface AsteroidSpawnDefinition {
  position: Vector2;
  velocity: Vector2;
  radius: number;
  spin?: number;
  seed?: number;
  spriteIndex?: number;
  name?: string;
  materialClass?: AsteroidEntity['materialClass'];
  shapeClass?: AsteroidEntity['shapeClass'];
  sizeClass?: AsteroidEntity['sizeClass'];
  resourceType?: AsteroidResourceType;
  resourceTier?: ResourceTier;
  remainingYield?: number;
  stability?: number;
  structuralIntegrity?: number;
  maximumStructuralIntegrity?: number;
  fragmentGeneration?: number;
  collisionGraceSeconds?: number;
}

const cloneActions = (actions: FlightActionState): FlightActionState => ({ ...actions });

export class GameSimulation {
  public readonly entities = new EntityStore();
  public tick = 0;
  public elapsedSeconds = 0;
  public phase: FlightPhase = 'station';

  private readonly flightSystem: FlightSystem;
  private readonly asteroidSystem: AsteroidSystem;
  private readonly asteroidCollisionSystem: AsteroidCollisionSystem;
  private readonly debrisSystem: DebrisSystem;
  private readonly collisionSystem: CollisionSystem;
  private readonly navigationSystem: NavigationSystem;
  private readonly autopilotSystem: AutopilotSystem;
  private readonly miningSystem: MiningSystem;
  private readonly traderSystem: TraderSystem;
  private readonly events: SimulationEvent[] = [];
  private seed: number;
  private installedModules: ModuleId[];
  private selectedTargetValue: TargetReference | null = null;
  private navigationBeaconValue: NavigationDestination | null = null;
  private autopilotEnabled = false;
  private autopilotTelemetry: AutopilotTelemetry = {
    status: 'idle',
    path: [],
    waypoint: null,
    resolvedGoal: vector(),
    remainingDistance: 0,
    maximumSpeed: 0,
  };
  private currentStationId: EntityId | null = null;
  private approachAssistEnabled = false;
  private previousActions: FlightActionState = neutralFlightActions();
  private appliedActions: FlightActionState = neutralFlightActions();
  private assistModeValue: 'manual' | 'approach' | 'autopilot' = 'manual';
  private desiredVelocityValue: Vector2 = vector();
  private dockingSeconds = 0;
  private dockingAnnounced = false;
  private debrisSequence = 0;

  public constructor(
    public readonly config: Tuning = tuning,
    seed = 0xb37e_2026,
    installedModules: readonly ModuleId[] = ['mining-drone'],
  ) {
    this.seed = seed;
    this.installedModules = [...installedModules];
    this.flightSystem = new FlightSystem(config);
    this.asteroidSystem = new AsteroidSystem(config);
    this.asteroidCollisionSystem = new AsteroidCollisionSystem(config);
    this.debrisSystem = new DebrisSystem(config);
    this.collisionSystem = new CollisionSystem(config);
    this.navigationSystem = new NavigationSystem(config);
    this.autopilotSystem = new AutopilotSystem(config);
    this.miningSystem = new MiningSystem(config);
    this.traderSystem = new TraderSystem(config);
    this.initialize(seed, installedModules);
  }

  public initialize(seed = this.seed, installedModules: readonly ModuleId[] = this.installedModules): void {
    this.seed = seed;
    this.installedModules = [...installedModules];
    this.tick = 0;
    this.elapsedSeconds = 0;
    this.phase = 'station';
    this.events.length = 0;
    this.entities.clear();
    this.collisionSystem.reset();
    this.asteroidCollisionSystem.reset();
    this.miningSystem.reset();
    this.traderSystem.reset();
    this.selectedTargetValue = null;
    this.navigationBeaconValue = null;
    this.autopilotEnabled = false;
    this.autopilotSystem.reset();
    this.autopilotTelemetry = {
      status: 'idle',
      path: [],
      waypoint: null,
      resolvedGoal: vector(),
      remainingDistance: 0,
      maximumSpeed: 0,
    };
    this.currentStationId = null;
    this.approachAssistEnabled = false;
    this.previousActions = neutralFlightActions();
    this.appliedActions = neutralFlightActions();
    this.assistModeValue = 'manual';
    this.desiredVelocityValue = vector();
    this.dockingSeconds = 0;
    this.dockingAnnounced = false;
    this.debrisSequence = 0;

    this.createShip();
    this.createStations();
    this.currentStationId = this.station.id;
    const dockedPosition = this.getStationDockPosition(this.station);
    this.ship.transform.position = { ...dockedPosition };
    this.ship.transform.previousPosition = { ...dockedPosition };
    this.createAsteroidField(seed);
    this.createTrader();
  }

  public launch(): boolean {
    if (this.phase !== 'station') {
      return false;
    }
    const ship = this.ship;
    const currentStation = this.getCurrentStation();
    const position = this.getStationDockPosition(currentStation);
    ship.transform.position = position;
    ship.transform.previousPosition = { ...position };
    ship.transform.heading = 0;
    ship.transform.previousHeading = 0;
    ship.velocity.linear = vector(0, -2.4);
    ship.velocity.angular = 0;
    this.phase = 'flight';
    this.selectedTargetValue = null;
    this.approachAssistEnabled = false;
    this.autopilotEnabled = false;
    this.autopilotSystem.reset();
    this.dockingSeconds = 0;
    this.dockingAnnounced = false;
    this.events.push({ type: 'LaunchCompleted', tick: this.tick });
    return true;
  }

  public step(deltaSeconds: number, actions: FlightActionState = neutralFlightActions()): void {
    this.tick += 1;
    this.elapsedSeconds += deltaSeconds;

    if (this.phase === 'station') {
      this.freezeShipTransform();
      this.previousActions = cloneActions(actions);
      this.appliedActions = neutralFlightActions();
      return;
    }

    this.processActionEdges(actions);
    const ship = this.ship;
    this.refreshNavigationBeacon();
    this.updateNavigationRoute(deltaSeconds);
    const autopilotTarget = this.autopilotEnabled
      ? this.getAutopilotTarget()
      : null;
    const target = autopilotTarget ?? this.getNavigationTarget();
    const resolution = this.navigationSystem.resolve(
      ship,
      actions,
      target,
      this.autopilotEnabled || this.approachAssistEnabled,
    );
    if (resolution.manualOverride) {
      if (this.autopilotEnabled) {
        this.setAutopilot(false);
      }
      if (this.approachAssistEnabled) {
        this.setApproachAssist(false);
      }
    }
    this.appliedActions = resolution.actions;
    this.assistModeValue = this.autopilotEnabled && !resolution.manualOverride
      ? 'autopilot'
      : resolution.mode;
    this.desiredVelocityValue = resolution.desiredVelocity;

    if (ship.hull > 0) {
      this.flightSystem.update(ship, this.appliedActions, deltaSeconds);
    } else {
      this.freezeShipTransform();
      this.phase = 'disabled';
    }

    this.asteroidSystem.update(this.entities.asteroids.values(), deltaSeconds);
    const asteroidImpacts = this.asteroidCollisionSystem.update(this.entities.asteroids);
    this.resolveAsteroidImpacts(asteroidImpacts);
    for (const trader of this.entities.traders.values()) {
      this.traderSystem.update(
        trader,
        this.entities.stations,
        this.entities.asteroids.values(),
        deltaSeconds,
      );
    }
    this.debrisSystem.update(this.entities.debris, deltaSeconds);

    const selectedAsteroid = this.getSelectedAsteroid();
    this.miningSystem.update(
      this.entities,
      ship,
      selectedAsteroid,
      deltaSeconds,
      this.tick,
      {
        emit: (event) => this.events.push(event),
        spawnDebris: (asteroid) => this.spawnMiningDebris(asteroid),
      },
    );

    let shipFractureRequest: { asteroidId: EntityId; relativeSpeed: number; normal: Vector2 } | null = null;
    this.collisionSystem.update(
      ship,
      this.entities.asteroids.values(),
      this.entities.traders.values(),
      this.entities.debris,
      this.tick,
      (event) => {
        this.events.push(event);
        if (event.type === 'CollisionOccurred' && event.relativeSpeed >= this.config.mining.emergencyRecallSpeed) {
          this.miningSystem.requestRecall(this.entities);
        }
        if (event.type === 'CollisionOccurred' && event.objectKind === 'asteroid') {
          shipFractureRequest = {
            asteroidId: event.objectId,
            relativeSpeed: event.relativeSpeed,
            normal: event.normal,
          };
        }
        if (event.type === 'CollisionOccurred' && event.damage > 0) {
          this.damageMountedEquipment(event.normal, event.damage, event.closingSpeed);
        }
      },
    );
    if (shipFractureRequest !== null) {
      const request = shipFractureRequest as { asteroidId: EntityId; relativeSpeed: number; normal: Vector2 };
      const asteroid = this.entities.asteroids.get(request.asteroidId);
      if (asteroid !== undefined && this.shouldFracture(asteroid, request.relativeSpeed)) {
        this.fragmentAsteroid(asteroid, request.relativeSpeed, request.normal, 'ship');
      }
    }

    this.updateDocking(deltaSeconds);
    this.previousActions = cloneActions(actions);
  }

  public drainEvents(): SimulationEvent[] {
    return this.events.splice(0, this.events.length);
  }

  public applyLoadout(installedModules: readonly ModuleId[]): void {
    const loadout: Record<HardpointId, ModuleId | null> = {
      port: null,
      starboard: null,
      ventral: 'mining-drone',
    };
    let starterDroneConsumed = false;
    const internalModules = installedModules.filter((moduleId) => !isHardpointModule(moduleId));
    const remaining = installedModules.filter((moduleId) => {
      if (!isHardpointModule(moduleId)) {
        return false;
      }
      if (moduleId === 'mining-drone' && !starterDroneConsumed) {
        starterDroneConsumed = true;
        return false;
      }
      return true;
    });
    for (const hardpoint of hardpointIds) {
      if (loadout[hardpoint] === null) {
        loadout[hardpoint] = remaining.shift() ?? null;
      }
    }
    this.applyHardpointLoadout(
      loadout,
      { port: 100, starboard: 100, ventral: 100 },
      internalModules,
    );
  }

  public applyHardpointLoadout(
    loadout: Readonly<Record<HardpointId, ModuleId | null>>,
    conditions: Readonly<Record<HardpointId, number>>,
    internalModules: readonly ModuleId[] = this.installedModules.filter(
      (moduleId) => !isHardpointModule(moduleId),
    ),
  ): void {
    const sanitizedLoadout = Object.fromEntries(hardpointIds.map((hardpoint) => {
      const moduleId = loadout[hardpoint];
      return [hardpoint, moduleId !== null && isHardpointModule(moduleId) ? moduleId : null];
    })) as Record<HardpointId, ModuleId | null>;
    const hardpointModules = hardpointIds
      .map((hardpoint) => sanitizedLoadout[hardpoint])
      .filter((moduleId): moduleId is ModuleId => moduleId !== null);
    const installedInternalModules = internalModules.filter(
      (moduleId, index) => !isHardpointModule(moduleId) && internalModules.indexOf(moduleId) === index,
    );
    const installedModules = [...hardpointModules, ...installedInternalModules];
    this.installedModules = [...installedModules];
    for (const hardpoint of hardpointIds) {
      this.ship.hardpoints[hardpoint] = {
        moduleId: sanitizedLoadout[hardpoint],
        condition: Math.min(100, Math.max(0, conditions[hardpoint])),
      };
    }
    const operationalModules = hardpointIds
      .filter((hardpoint) => this.ship.hardpoints[hardpoint].condition > 0)
      .map((hardpoint) => this.ship.hardpoints[hardpoint].moduleId)
      .filter((moduleId): moduleId is ModuleId => moduleId !== null);
    const stats = aggregateShipStats({
      dryMass: this.config.ship.dryMass,
      cargoCapacity: this.config.ship.cargoCapacity,
      forwardThrust: this.config.ship.forwardThrust,
      reverseThrust: this.config.ship.reverseThrust,
      rotationalAcceleration: this.config.ship.rotationalAcceleration,
    }, operationalModules);
    const ship = this.ship;
    ship.dryMass = stats.dryMass;
    ship.cargoCapacity = stats.cargoCapacity;
    ship.forwardThrust = stats.forwardThrust;
    ship.reverseThrust = stats.reverseThrust;
    ship.rotationalAcceleration = stats.rotationalAcceleration;
    ship.fuelUseMultiplier = stats.fuelUseMultiplier;
    ship.installedModules = [...installedModules];
    const operationalDrones = hardpointIds.filter((hardpoint) => {
      const equipment = ship.hardpoints[hardpoint];
      return equipment.moduleId === 'mining-drone' && equipment.condition > 0;
    }).length;
    const deployedDrones = this.entities.drones.size;
    ship.maxDrones = operationalDrones;
    ship.dronesAboard = Math.max(0, operationalDrones - deployedDrones);
    if (!this.flightAssistInstalled) {
      this.setApproachAssist(false);
    }
  }

  public get flightAssistInstalled(): boolean {
    return this.installedModules.includes('flight-assist');
  }

  public selectTargetAt(worldPosition: Vector2, extraHitRadius = 18): TargetReference | null {
    if (this.phase === 'station') {
      return null;
    }
    let best: { reference: TargetReference; score: number; name: string } | null = null;
    for (const asteroid of this.entities.asteroids.values()) {
      const offset = subtract(worldPosition, asteroid.transform.position);
      const centreDistance = length(offset);
      const direction = centreDistance > 0.001 ? scale(offset, 1 / centreDistance) : vector(1, 0);
      const score = centreDistance - getAsteroidSupportRadius(asteroid, direction);
      if (score <= extraHitRadius && (best === null || score < best.score)) {
        best = {
          reference: { kind: 'asteroid', id: asteroid.id },
          score,
          name: asteroid.name,
        };
      }
    }
    for (const station of this.entities.stations.values()) {
      const stationScore = distance(worldPosition, station.transform.position) - station.collider.radius;
      if (stationScore <= extraHitRadius && (best === null || stationScore < best.score)) {
        best = {
          reference: { kind: 'station', id: station.id },
          score: stationScore,
          name: station.name,
        };
      }
    }
    for (const trader of this.entities.traders.values()) {
      const offset = subtract(worldPosition, trader.transform.position);
      const centreDistance = length(offset);
      const direction = centreDistance > 0.001 ? scale(offset, 1 / centreDistance) : vector(1, 0);
      const traderScore = centreDistance - getShipSupportRadius(trader, direction);
      if (traderScore <= extraHitRadius && (best === null || traderScore < best.score)) {
        best = {
          reference: { kind: 'trader', id: trader.id },
          score: traderScore,
          name: trader.name,
        };
      }
    }

    if (best === null) {
      this.clearTarget();
      return null;
    }
    this.setAutopilot(false);
    if (best.reference.kind === 'trader') {
      this.setEntityNavigationBeacon('trader', best.reference.id);
      return best.reference;
    }
    this.setSelectedTarget(best.reference, best.name);
    return best.reference;
  }

  public selectAsteroid(id: EntityId): boolean {
    const asteroid = this.entities.asteroids.get(id);
    if (asteroid === undefined) {
      return false;
    }
    this.setAutopilot(false);
    this.setSelectedTarget({ kind: 'asteroid', id }, asteroid.name);
    return true;
  }

  public selectStation(enableAssist = false, stationId = this.station.id): void {
    const station = this.entities.stations.get(stationId) ?? this.station;
    this.setAutopilot(false);
    this.setSelectedTarget({ kind: 'station', id: station.id }, station.name);
    if (enableAssist) {
      this.setApproachAssist(true);
    }
  }

  public setNavigationBeacon(destination: NavigationDestination): boolean {
    if (this.phase === 'station') {
      return false;
    }
    const station = destination.kind === 'station'
      ? this.getStationForDestination(destination.id)
      : null;
    if (destination.kind === 'station' && station === null) {
      return false;
    }
    this.setAutopilot(false);
    this.navigationBeaconValue = {
      ...destination,
      position: { ...destination.position },
    };
    this.setApproachAssist(false);
    this.miningSystem.requestRecall(this.entities);
    if (destination.kind === 'station') {
      if (station === null) {
        return false;
      }
      this.setSelectedTarget({ kind: 'station', id: station.id }, station.name);
    } else {
      this.clearTarget();
    }
    this.autopilotSystem.reset();
    this.updateNavigationRoute(0);
    return true;
  }

  public setEntityNavigationBeacon(kind: 'trader' | 'asteroid', entityId: EntityId): boolean {
    if (this.phase === 'station') {
      return false;
    }
    const trader = kind === 'trader' ? this.entities.traders.get(entityId) : undefined;
    const asteroid = kind === 'asteroid' ? this.entities.asteroids.get(entityId) : undefined;
    if (kind === 'trader' && trader === undefined) {
      return false;
    }
    if (kind === 'asteroid' && (asteroid === undefined || asteroid.sizeClass !== 'very-large')) {
      return false;
    }
    const entity = trader ?? asteroid;
    if (entity === undefined) {
      return false;
    }
    this.setAutopilot(false);
    this.navigationBeaconValue = {
      id: `${kind}:${entity.id}`,
      kind,
      name: entity.name,
      code: trader?.code ?? `MASSIF ${entity.id}`,
      position: { ...entity.transform.position },
      description: kind === 'trader'
        ? 'Independent ship transponder.'
        : 'Trackable very-large asteroid.',
    };
    this.setApproachAssist(false);
    this.miningSystem.requestRecall(this.entities);
    this.setSelectedTarget({ kind, id: entity.id }, entity.name);
    this.autopilotSystem.reset();
    this.updateNavigationRoute(0);
    return true;
  }

  public toggleAutopilot(): boolean {
    if (!this.flightAssistInstalled || this.navigationBeaconValue === null || this.phase === 'station') {
      return false;
    }
    this.setApproachAssist(false);
    this.miningSystem.requestRecall(this.entities);
    this.setAutopilot(!this.autopilotEnabled);
    if (this.autopilotEnabled) {
      this.autopilotSystem.reset();
      this.updateNavigationRoute(0);
    }
    return this.autopilotEnabled;
  }

  public clearNavigationBeacon(): void {
    this.setAutopilot(false);
    this.navigationBeaconValue = null;
  }

  public clearTarget(): void {
    if (this.selectedTargetValue === null) {
      return;
    }
    this.selectedTargetValue = null;
    this.setApproachAssist(false);
    this.miningSystem.onTargetChanged(null, this.entities);
    this.events.push({ type: 'TargetCleared', tick: this.tick });
  }

  public toggleApproachAssist(): boolean {
    if (!this.flightAssistInstalled || this.selectedTargetValue === null || this.phase === 'station') {
      return false;
    }
    this.setAutopilot(false);
    this.setApproachAssist(!this.approachAssistEnabled);
    return this.approachAssistEnabled;
  }

  public recallDrones(): void {
    this.miningSystem.requestRecall(this.entities);
  }

  public contextAction(): string {
    if (this.entities.drones.size > 0) {
      this.recallDrones();
      return 'RECALL';
    }
    if (this.autopilotEnabled) {
      this.setAutopilot(false);
      return 'AUTOPILOT OFF';
    }
    if (this.selectedTargetValue !== null) {
      if (!this.flightAssistInstalled) {
        return 'ASSIST UPGRADE REQUIRED';
      }
      this.toggleApproachAssist();
      return this.approachAssistEnabled ? 'ASSIST ON' : 'ASSIST OFF';
    }
    const tutorial = this.getTutorialAsteroid();
    if (tutorial !== null) {
      this.selectAsteroid(tutorial.id);
      return 'TARGET';
    }
    return 'NO ACTION';
  }

  public clearCargo(): void {
    this.ship.cargo = createEmptyCargo();
    this.ship.cargoMass = 0;
  }

  public repairAndRefuel(): void {
    this.ship.hull = this.ship.maxHull;
    this.ship.fuel = this.ship.fuelCapacity;
    this.ship.dronesAboard = this.ship.maxDrones;
    for (const hardpoint of hardpointIds) {
      this.ship.hardpoints[hardpoint].condition = 100;
    }
    this.applyHardpointLoadout(
      {
        port: this.ship.hardpoints.port.moduleId,
        starboard: this.ship.hardpoints.starboard.moduleId,
        ventral: this.ship.hardpoints.ventral.moduleId,
      },
      { port: 100, starboard: 100, ventral: 100 },
    );
  }

  public setCargoMass(cargoMass: number): void {
    const amount = Math.min(this.ship.cargoCapacity, Math.max(0, cargoMass));
    this.ship.cargo = { water: 0, industrial: amount, rare: 0 };
    this.ship.cargoMass = amount;
  }

  public clearAsteroids(): void {
    this.entities.asteroids.clear();
    this.collisionSystem.reset();
    this.asteroidCollisionSystem.reset();
    this.clearTarget();
  }

  public spawnAsteroid(definition: AsteroidSpawnDefinition): AsteroidEntity {
    const seed = definition.seed ?? Math.floor(Math.abs(definition.position.x * 19 + definition.position.y * 31));
    const materialClass = definition.materialClass ?? 'carbonaceous';
    const resourceType = definition.resourceType ?? this.resourceForMaterial(materialClass);
    const resourceTier = definition.resourceTier ?? 'standard';
    const spriteIndex = definition.spriteIndex ?? Math.abs(seed) % 4;
    const maximumYield = resourceType === 'none'
      ? 0
      : definition.remainingYield
        ?? Math.max(3, definition.radius * resourceTierDefinitions[resourceTier].yieldMultiplier);
    const sizeClass = definition.sizeClass ?? this.sizeClassForRadius(definition.radius);
    const maximumStructuralIntegrity = definition.maximumStructuralIntegrity
      ?? this.structuralIntegrityFor(sizeClass, materialClass);
    return this.entities.addAsteroid({
      kind: 'asteroid',
      transform: {
        position: { ...definition.position },
        previousPosition: { ...definition.position },
        heading: 0,
        previousHeading: 0,
      },
      velocity: {
        linear: { ...definition.velocity },
        angular: definition.spin ?? 0,
      },
      collider: { radius: definition.radius },
      radius: definition.radius,
      seed,
      spriteIndex,
      name: definition.name ?? `${materialClass.slice(0, 1).toUpperCase()}-${Math.abs(seed) % 997}`,
      materialClass,
      shapeClass: definition.shapeClass ?? this.shapeForIndex(spriteIndex),
      sizeClass,
      resourceType,
      resourceTier,
      remainingYield: maximumYield,
      maximumYield,
      stability: definition.stability ?? 0.65,
      structuralIntegrity: Math.min(
        maximumStructuralIntegrity,
        definition.structuralIntegrity ?? maximumStructuralIntegrity,
      ),
      maximumStructuralIntegrity,
      fragmentGeneration: definition.fragmentGeneration ?? 0,
      collisionGraceSeconds: definition.collisionGraceSeconds ?? 0,
    });
  }

  public getInterpolatedShip(alpha: number): InterpolatedTransform {
    return this.interpolateTransform(this.ship, alpha);
  }

  public getInterpolatedAsteroid(asteroid: AsteroidEntity, alpha: number): InterpolatedTransform {
    return this.interpolateTransform(asteroid, alpha);
  }

  public getInterpolatedTrader(trader: TraderEntity, alpha: number): InterpolatedTransform {
    return this.interpolateTransform(trader, alpha);
  }

  public getInterpolatedDrone(drone: DroneEntity, alpha: number): InterpolatedTransform {
    return this.interpolateTransform(drone, alpha);
  }

  public getInterpolatedDebris(debris: DebrisEntity, alpha: number): InterpolatedTransform {
    return this.interpolateTransform(debris, alpha);
  }

  public getDebugSnapshot(): SimulationDebugSnapshot {
    const ship = this.ship;
    const dockedStation = this.getCurrentStation();
    const target = this.getTargetSnapshot();
    const selectedAsteroid = this.getSelectedAsteroid();
    const mining = this.miningSystem.getTelemetry(ship, selectedAsteroid);
    const dockingEligible = this.isDockingEligible();
    return {
      tick: this.tick,
      elapsedSeconds: this.elapsedSeconds,
      entityCount: this.entities.entityCount,
      phase: this.phase,
      assistEnabled: this.approachAssistEnabled,
      autopilotAvailable: this.flightAssistInstalled,
      assistMode: this.assistModeValue,
      desiredVelocity: { ...this.desiredVelocityValue },
      appliedActions: { ...this.appliedActions },
      ship: {
        position: { ...ship.transform.position },
        velocity: { ...ship.velocity.linear },
        speed: length(ship.velocity.linear),
        heading: ship.transform.heading,
        angularVelocity: ship.velocity.angular,
        mass: ship.dryMass + ship.cargoMass,
        dryMass: ship.dryMass,
        cargoMass: ship.cargoMass,
        cargoCapacity: ship.cargoCapacity,
        cargo: { ...ship.cargo },
        hull: ship.hull,
        maxHull: ship.maxHull,
        fuel: ship.fuel,
        fuelCapacity: ship.fuelCapacity,
        dronesAboard: ship.dronesAboard,
        dronesDeployed: this.entities.drones.size,
        maxDrones: ship.maxDrones,
        forwardThrust: ship.forwardThrust,
        reverseThrust: ship.reverseThrust,
        accelerationPotential: ship.forwardThrust / Math.max(0.001, ship.dryMass + ship.cargoMass),
        installedModules: [...ship.installedModules],
        cargoBayActive: [...this.entities.drones.values()].some((drone) => drone.state === 'unloading'),
        hardpoints: {
          port: this.getHardpointSnapshot('port'),
          starboard: this.getHardpointSnapshot('starboard'),
          ventral: this.getHardpointSnapshot('ventral'),
        },
      },
      target,
      navigationBeacon: this.navigationBeaconValue === null
        ? null
        : {
            id: this.navigationBeaconValue.id,
            kind: this.navigationBeaconValue.kind,
            name: this.navigationBeaconValue.name,
            code: this.navigationBeaconValue.code,
            position: { ...this.navigationBeaconValue.position },
            distance: distance(ship.transform.position, this.navigationBeaconValue.position),
          },
      autopilot: {
        enabled: this.autopilotEnabled,
        status: this.autopilotTelemetry.status,
        destinationId: this.navigationBeaconValue?.id ?? null,
        remainingDistance: this.autopilotTelemetry.remainingDistance,
        waypoint: this.autopilotTelemetry.waypoint === null
          ? null
          : { ...this.autopilotTelemetry.waypoint },
        path: this.autopilotTelemetry.path.map((point) => ({ ...point })),
      },
      dockedStation: {
        id: dockedStation.id,
        destinationId: dockedStation.destinationId,
        name: dockedStation.name,
        code: dockedStation.code,
      },
      traders: [...this.entities.traders.values()].map((trader) => ({
        id: trader.id,
        name: trader.name,
        code: trader.code,
        state: trader.state,
        position: { ...trader.transform.position },
        velocity: { ...trader.velocity.linear },
        speed: length(trader.velocity.linear),
        currentStationId: trader.currentStationId,
        destinationStationId: trader.destinationStationId,
        dockingSecondsRemaining: trader.dockingSecondsRemaining,
        route: trader.route.map((point) => ({ ...point })),
      })),
      trackableAsteroids: [...this.entities.asteroids.values()]
        .filter((asteroid) => asteroid.sizeClass === 'very-large')
        .map((asteroid) => ({
          id: asteroid.id,
          name: asteroid.name,
          code: `MASSIF ${asteroid.id}`,
          position: { ...asteroid.transform.position },
          velocity: { ...asteroid.velocity.linear },
          materialClass: asteroid.materialClass,
          resourceType: asteroid.resourceType,
          structuralIntegrity: asteroid.structuralIntegrity,
          maximumStructuralIntegrity: asteroid.maximumStructuralIntegrity,
        })),
      mining: {
        status: mining.status,
        stableProgress: mining.stableProgress,
        surfaceDistance: mining.surfaceDistance,
        relativeSpeed: mining.relativeSpeed,
        activeDrones: this.entities.drones.size,
        suppressed: mining.suppressed,
      },
      docking: {
        progress: Math.min(1, this.dockingSeconds / this.config.station.dockingStabilizeSeconds),
        eligible: dockingEligible,
      },
      objective: this.getObjective(target, mining.status),
      contextActionLabel: this.getContextActionLabel(target),
      contextActionEnabled: this.phase !== 'station' && this.phase !== 'disabled',
    };
  }

  public get ship(): ShipEntity {
    if (this.entities.ship === null) {
      throw new Error('Simulation ship has not been initialized.');
    }
    return this.entities.ship;
  }

  public get station(): StationEntity {
    if (this.entities.station === null) {
      throw new Error('Simulation station has not been initialized.');
    }
    return this.entities.station;
  }

  public get selectedTarget(): Readonly<TargetReference> | null {
    return this.selectedTargetValue;
  }

  public get tutorialAsteroidId(): EntityId | null {
    return this.getTutorialAsteroid()?.id ?? null;
  }

  public debugTeleportNearTarget(surfaceDistance = 28): void {
    const target = this.getSelectedAsteroid();
    if (target === null) {
      return;
    }
    const direction = vector(0, 1);
    const offset = getAsteroidSupportRadius(target, direction)
      + this.ship.collider.radius
      + surfaceDistance;
    const position = add(target.transform.position, scale(direction, offset));
    this.ship.transform.position = position;
    this.ship.transform.previousPosition = { ...position };
    this.ship.velocity.linear = { ...target.velocity.linear };
    this.ship.velocity.angular = 0;
    this.ship.transform.heading = 0;
    this.ship.transform.previousHeading = 0;
  }

  public debugPrepareDocking(): void {
    if (this.phase === 'station') {
      this.launch();
    }
    this.recallDrones();
    this.entities.drones.clear();
    this.ship.dronesAboard = this.ship.maxDrones;
    this.selectStation(false, this.station.id);
    const position = vector(
      this.station.transform.position.x,
      this.station.transform.position.y - this.config.station.dockingDistance + 1,
    );
    this.ship.transform.position = position;
    this.ship.transform.previousPosition = { ...position };
    this.ship.velocity.linear = { ...this.station.velocity.linear };
    this.ship.velocity.angular = 0;
    this.ship.transform.heading = 0;
    this.ship.transform.previousHeading = 0;
    this.phase = 'flight';
    this.dockingSeconds = 0;
    this.dockingAnnounced = false;
  }

  private interpolateTransform(
    entity: Pick<ShipEntity | AsteroidEntity | DroneEntity | DebrisEntity, 'transform'>,
    alpha: number,
  ): InterpolatedTransform {
    const interpolation = Math.min(1, Math.max(0, alpha));
    return {
      position: lerpVector(
        entity.transform.previousPosition,
        entity.transform.position,
        interpolation,
      ),
      heading: lerpAngle(
        entity.transform.previousHeading,
        entity.transform.heading,
        interpolation,
      ),
    };
  }

  private freezeShipTransform(): void {
    const ship = this.ship;
    ship.transform.previousPosition = { ...ship.transform.position };
    ship.transform.previousHeading = ship.transform.heading;
  }

  private processActionEdges(actions: FlightActionState): void {
    if (actions.approachAssist && !this.previousActions.approachAssist) {
      this.toggleApproachAssist();
    }
    if (actions.recallDrones && !this.previousActions.recallDrones) {
      this.recallDrones();
    }
    if (actions.dockOrInteract && !this.previousActions.dockOrInteract) {
      this.contextAction();
    }
  }

  private setApproachAssist(enabled: boolean): void {
    if (enabled && !this.flightAssistInstalled) {
      return;
    }
    if (this.approachAssistEnabled === enabled) {
      return;
    }
    this.approachAssistEnabled = enabled;
    this.events.push({ type: 'AssistChanged', tick: this.tick, enabled });
  }

  private setAutopilot(enabled: boolean, arrived = false): void {
    if (enabled && !this.flightAssistInstalled) {
      return;
    }
    if (this.autopilotEnabled === enabled) {
      return;
    }
    this.autopilotEnabled = enabled;
    if (!enabled) {
      this.autopilotSystem.reset();
      this.autopilotTelemetry = {
        status: arrived ? 'arrived' : 'idle',
        path: [],
        waypoint: null,
        resolvedGoal: this.navigationBeaconValue?.position ?? vector(),
        remainingDistance: this.navigationBeaconValue === null
          ? 0
          : distance(this.ship.transform.position, this.navigationBeaconValue.position),
        maximumSpeed: 0,
      };
    }
    this.events.push({
      type: 'AutopilotChanged',
      tick: this.tick,
      enabled,
      arrived,
    });
  }

  private setSelectedTarget(reference: TargetReference, name: string): void {
    const changed = this.selectedTargetValue?.kind !== reference.kind
      || this.selectedTargetValue.id !== reference.id;
    this.selectedTargetValue = reference;
    this.setApproachAssist(false);
    this.miningSystem.onTargetChanged(reference.kind === 'asteroid' ? reference.id : null, this.entities);
    this.dockingSeconds = 0;
    this.dockingAnnounced = false;
    if (changed) {
      this.events.push({
        type: 'TargetSelected',
        tick: this.tick,
        targetKind: reference.kind,
        targetId: reference.id,
        name,
      });
    }
  }

  private getSelectedAsteroid(): AsteroidEntity | null {
    if (this.selectedTargetValue?.kind !== 'asteroid') {
      return null;
    }
    return this.entities.asteroids.get(this.selectedTargetValue.id) ?? null;
  }

  private getHardpointSnapshot(hardpoint: HardpointId): {
    moduleId: ModuleId | null;
    condition: number;
    operational: boolean;
    occupied: boolean;
  } {
    const equipment = this.ship.hardpoints[hardpoint];
    const deployedFromHardpoint = [...this.entities.drones.values()].some(
      (drone) => drone.assignedHardpoint === hardpoint,
    );
    return {
      moduleId: equipment.moduleId,
      condition: equipment.condition,
      operational: equipment.moduleId !== null && equipment.condition > 0,
      occupied: equipment.moduleId !== null && !deployedFromHardpoint,
    };
  }

  private damageMountedEquipment(
    collisionNormal: Vector2,
    hullDamage: number,
    closingSpeed: number,
  ): void {
    const incomingLocal = rotate(scale(collisionNormal, -1), -this.ship.transform.heading);
    const directions: Record<HardpointId, Vector2> = {
      port: vector(-1, 0),
      starboard: vector(1, 0),
      ventral: vector(0, 1),
    };
    const candidates = hardpointIds
      .filter((hardpoint) => {
        const equipment = this.ship.hardpoints[hardpoint];
        const deployed = [...this.entities.drones.values()].some(
          (drone) => drone.assignedHardpoint === hardpoint,
        );
        return equipment.moduleId !== null && !deployed;
      })
      .sort((first, second) => dot(incomingLocal, directions[second]) - dot(incomingLocal, directions[first]));
    const hardpoint = candidates[0];
    if (hardpoint === undefined) {
      return;
    }
    const equipment = this.ship.hardpoints[hardpoint];
    const moduleId = equipment.moduleId;
    if (moduleId === null) {
      return;
    }
    const previousCondition = equipment.condition;
    const equipmentDamage = Math.min(45, hullDamage * 1.25 + Math.max(0, closingSpeed - 5) * 0.8);
    equipment.condition = Math.max(0, equipment.condition - equipmentDamage);
    if (equipment.condition <= 0 && previousCondition > 0) {
      this.applyHardpointLoadout(
        {
          port: this.ship.hardpoints.port.moduleId,
          starboard: this.ship.hardpoints.starboard.moduleId,
          ventral: this.ship.hardpoints.ventral.moduleId,
        },
        {
          port: this.ship.hardpoints.port.condition,
          starboard: this.ship.hardpoints.starboard.condition,
          ventral: this.ship.hardpoints.ventral.condition,
        },
      );
    }
    this.events.push({
      type: 'EquipmentDamaged',
      tick: this.tick,
      hardpoint,
      moduleId,
      condition: equipment.condition,
      disabled: equipment.condition <= 0,
    });
  }

  private getSelectedStation(): StationEntity | null {
    if (this.selectedTargetValue?.kind !== 'station') {
      return null;
    }
    return this.entities.stations.get(this.selectedTargetValue.id) ?? null;
  }

  private getCurrentStation(): StationEntity {
    if (this.currentStationId !== null) {
      const current = this.entities.stations.get(this.currentStationId);
      if (current !== undefined) {
        return current;
      }
    }
    return this.station;
  }

  private getStationForDestination(destinationId: string): StationEntity | null {
    for (const station of this.entities.stations.values()) {
      if (station.destinationId === destinationId) {
        return station;
      }
    }
    return null;
  }

  private getStationDockPosition(station: StationEntity): Vector2 {
    const dockOffset = this.config.station.positionY - this.config.station.dockedShipY;
    return vector(station.transform.position.x, station.transform.position.y - dockOffset);
  }

  private refreshNavigationBeacon(): void {
    const destination = this.navigationBeaconValue;
    if (destination === null) {
      return;
    }
    if (destination.kind === 'trader') {
      const trader = this.entities.traders.get(Number(destination.id.split(':')[1]));
      if (trader === undefined) {
        this.clearNavigationBeacon();
        return;
      }
      destination.position = { ...trader.transform.position };
    } else if (destination.kind === 'asteroid') {
      const asteroid = this.entities.asteroids.get(Number(destination.id.split(':')[1]));
      if (asteroid === undefined) {
        this.clearNavigationBeacon();
        return;
      }
      destination.position = { ...asteroid.transform.position };
    }
  }

  private getNavigationRouteGoal(): {
    position: Vector2;
    velocity: Vector2;
    arrivalRadius: number;
    excludedObstacleId: EntityId | null;
  } | null {
    const destination = this.navigationBeaconValue;
    if (destination === null) {
      return null;
    }
    if (destination.kind === 'station') {
      const station = this.getStationForDestination(destination.id);
      return station === null
        ? null
        : {
            position: this.getStationDockPosition(station),
            velocity: { ...station.velocity.linear },
            arrivalRadius: 8,
            excludedObstacleId: null,
          };
    }
    if (destination.kind === 'trader') {
      const trader = this.entities.traders.get(Number(destination.id.split(':')[1]));
      if (trader === undefined) {
        return null;
      }
      const away = normalize(subtract(this.ship.transform.position, trader.transform.position));
      return {
        position: add(
          trader.transform.position,
          scale(away, trader.collider.radius + this.ship.collider.radius + 18),
        ),
        velocity: { ...trader.velocity.linear },
        arrivalRadius: 10,
        excludedObstacleId: trader.id,
      };
    }
    if (destination.kind === 'asteroid') {
      const asteroid = this.entities.asteroids.get(Number(destination.id.split(':')[1]));
      if (asteroid === undefined) {
        return null;
      }
      const away = normalize(subtract(this.ship.transform.position, asteroid.transform.position));
      return {
        position: add(
          asteroid.transform.position,
          scale(
            away,
            asteroid.collider.radius + this.ship.collider.radius + this.config.navigation.asteroidStandoffSurface,
          ),
        ),
        velocity: { ...asteroid.velocity.linear },
        arrivalRadius: 10,
        excludedObstacleId: asteroid.id,
      };
    }
    return {
      position: { ...destination.position },
      velocity: vector(),
      arrivalRadius: this.config.navigation.autopilotArrivalRadius,
      excludedObstacleId: null,
    };
  }

  private updateNavigationRoute(deltaSeconds: number): void {
    const routeGoal = this.getNavigationRouteGoal();
    if (routeGoal === null) {
      if (this.autopilotEnabled) {
        this.setAutopilot(false);
      }
      return;
    }
    const obstacles = [
      ...[...this.entities.asteroids.values()].map((asteroid) => ({
        id: asteroid.id,
        position: asteroid.transform.position,
        velocity: asteroid.velocity.linear,
        radius: asteroid.collider.radius,
      })),
      ...[...this.entities.traders.values()].map((trader) => ({
        id: trader.id,
        position: trader.transform.position,
        velocity: trader.velocity.linear,
        radius: trader.collider.radius,
      })),
    ].filter((obstacle) => obstacle.id !== routeGoal.excludedObstacleId);
    this.autopilotTelemetry = this.autopilotSystem.update(
      this.ship.transform.position,
      routeGoal.position,
      obstacles,
      deltaSeconds,
      routeGoal.arrivalRadius,
      this.ship.velocity.linear,
    );

    if (
      this.autopilotEnabled
      && this.autopilotTelemetry.status === 'arrived'
      && length(this.ship.velocity.linear) <= 1.4
    ) {
      this.setAutopilot(false, true);
    }
  }

  private getAutopilotTarget(): NavigationTarget | null {
    const routeGoal = this.getNavigationRouteGoal();
    if (routeGoal === null) {
      this.setAutopilot(false);
      return null;
    }
    const waypoint = this.autopilotTelemetry.waypoint ?? routeGoal.position;
    return {
      kind: 'waypoint',
      position: waypoint,
      velocity: this.autopilotTelemetry.path.length > 1 ? vector() : routeGoal.velocity,
      radius: 0,
      maximumSpeed: this.autopilotTelemetry.maximumSpeed,
      arrivalRadius: this.autopilotTelemetry.path.length > 1 ? 5 : 0.6,
      transit: this.autopilotTelemetry.path.length > 1,
    };
  }

  private getNavigationTarget(): NavigationTarget | null {
    const reference = this.selectedTargetValue;
    if (reference === null) {
      return null;
    }
    if (reference.kind === 'station') {
      const station = this.entities.stations.get(reference.id);
      if (station === undefined) {
        return null;
      }
      return {
        kind: 'station',
        position: station.transform.position,
        velocity: station.velocity.linear,
        radius: station.collider.radius,
      };
    }
    if (reference.kind === 'trader') {
      const trader = this.entities.traders.get(reference.id);
      if (trader === undefined) {
        return null;
      }
      return {
        kind: 'trader',
        position: trader.transform.position,
        velocity: trader.velocity.linear,
        radius: trader.collider.radius,
      };
    }
    const asteroid = this.entities.asteroids.get(reference.id);
    if (asteroid === undefined) {
      return null;
    }
    return {
      kind: 'asteroid',
      position: asteroid.transform.position,
      velocity: asteroid.velocity.linear,
      radius: asteroid.collider.radius,
    };
  }

  private getTargetSnapshot(): TargetSnapshot | null {
    const reference = this.selectedTargetValue;
    if (reference === null) {
      return null;
    }
    const ship = this.ship;
    const targetEntity = reference.kind === 'station'
      ? this.entities.stations.get(reference.id) ?? null
      : reference.kind === 'trader'
        ? this.entities.traders.get(reference.id) ?? null
        : this.entities.asteroids.get(reference.id) ?? null;
    if (targetEntity === null) {
      return null;
    }
    const relativePosition = subtract(targetEntity.transform.position, ship.transform.position);
    const relativeVelocity = subtract(targetEntity.velocity.linear, ship.velocity.linear);
    const relativeSpeed = length(relativeVelocity);
    const lineOfSight = length(relativePosition) > 0.001 ? normalize(relativePosition) : vector(0, -1);
    const closingSpeed = -dot(relativeVelocity, lineOfSight);
    const relativeVelocitySquared = lengthSquared(relativeVelocity);
    const timeToClosestApproach = relativeVelocitySquared > 0.0001
      ? Math.min(60, Math.max(0, -dot(relativePosition, relativeVelocity) / relativeVelocitySquared))
      : 0;
    const closestOffset = add(relativePosition, scale(relativeVelocity, timeToClosestApproach));
    const currentSurfaceRadius = targetEntity.kind === 'asteroid'
      ? getAsteroidSupportRadius(targetEntity, scale(lineOfSight, -1))
      : targetEntity.kind === 'trader'
        ? getShipSupportRadius(targetEntity, scale(lineOfSight, -1))
        : targetEntity.collider.radius;
    const closestLineOfSight = length(closestOffset) > 0.001
      ? normalize(closestOffset)
      : lineOfSight;
    const closestSurfaceRadius = targetEntity.kind === 'asteroid'
      ? getAsteroidSupportRadius(targetEntity, scale(closestLineOfSight, -1))
      : targetEntity.kind === 'trader'
        ? getShipSupportRadius(targetEntity, scale(closestLineOfSight, -1))
        : targetEntity.collider.radius;
    const closestApproachDistance = Math.max(
      0,
      length(closestOffset) - getShipSupportRadius(ship, lineOfSight) - closestSurfaceRadius,
    );
    const distanceToSurface = Math.max(
      0,
      length(relativePosition) - getShipSupportRadius(ship, lineOfSight) - currentSurfaceRadius,
    );

    if (targetEntity.kind === 'station') {
      return {
        kind: 'station',
        id: targetEntity.id,
        name: targetEntity.name,
        position: { ...targetEntity.transform.position },
        velocity: { ...targetEntity.velocity.linear },
        radius: targetEntity.collider.radius,
        distanceToSurface,
        relativeSpeed,
        closingSpeed,
        resourceType: null,
        resourceLabel: 'Docking / market',
        materialClass: null,
        shapeClass: null,
        sizeClass: null,
        resourceTier: null,
        resourceTierLabel: '—',
        remainingYield: null,
        yieldPercent: null,
        stability: null,
        structuralIntegrity: null,
        maximumStructuralIntegrity: null,
        closestApproachDistance,
        timeToClosestApproach,
      };
    }
    if (targetEntity.kind === 'trader') {
      return {
        kind: 'trader',
        id: targetEntity.id,
        name: targetEntity.name,
        position: { ...targetEntity.transform.position },
        velocity: { ...targetEntity.velocity.linear },
        radius: targetEntity.collider.radius,
        distanceToSurface,
        relativeSpeed,
        closingSpeed,
        resourceType: null,
        resourceLabel: 'Independent traffic',
        materialClass: null,
        shapeClass: null,
        sizeClass: null,
        resourceTier: null,
        resourceTierLabel: '—',
        remainingYield: null,
        yieldPercent: null,
        stability: null,
        structuralIntegrity: null,
        maximumStructuralIntegrity: null,
        closestApproachDistance,
        timeToClosestApproach,
      };
    }

    return {
      kind: 'asteroid',
      id: targetEntity.id,
      name: targetEntity.name,
      position: { ...targetEntity.transform.position },
      velocity: { ...targetEntity.velocity.linear },
      radius: targetEntity.radius,
      distanceToSurface,
      relativeSpeed,
      closingSpeed,
      resourceType: targetEntity.resourceType,
      resourceLabel: targetEntity.resourceType === 'none'
        ? 'Barren rock'
        : resourceDefinitions[targetEntity.resourceType].label,
      materialClass: targetEntity.materialClass,
      shapeClass: targetEntity.shapeClass,
      sizeClass: targetEntity.sizeClass,
      resourceTier: targetEntity.resourceTier,
      resourceTierLabel: resourceTierDefinitions[targetEntity.resourceTier].label,
      remainingYield: targetEntity.remainingYield,
      yieldPercent: targetEntity.maximumYield > 0
        ? targetEntity.remainingYield / targetEntity.maximumYield
        : 0,
      stability: targetEntity.stability,
      structuralIntegrity: targetEntity.structuralIntegrity,
      maximumStructuralIntegrity: targetEntity.maximumStructuralIntegrity,
      closestApproachDistance,
      timeToClosestApproach,
    };
  }

  private updateDocking(deltaSeconds: number): void {
    if (this.selectedTargetValue?.kind !== 'station' || this.entities.drones.size > 0 || this.phase === 'disabled') {
      this.resetDockingProgress();
      return;
    }
    if (!this.isDockingEligible()) {
      if (this.phase === 'docking') {
        this.phase = 'flight';
      }
      this.resetDockingProgress();
      return;
    }

    this.phase = 'docking';
    this.dockingSeconds += deltaSeconds;
    if (!this.dockingAnnounced) {
      this.dockingAnnounced = true;
      this.events.push({ type: 'DockingStarted', tick: this.tick });
    }
    if (this.dockingSeconds < this.config.station.dockingStabilizeSeconds) {
      return;
    }

    const station = this.getSelectedStation();
    if (station === null) {
      this.resetDockingProgress();
      return;
    }
    const dockedPosition = this.getStationDockPosition(station);
    this.ship.transform.position = dockedPosition;
    this.ship.transform.previousPosition = { ...dockedPosition };
    this.ship.transform.heading = 0;
    this.ship.transform.previousHeading = 0;
    this.ship.velocity.linear = vector();
    this.ship.velocity.angular = 0;
    this.phase = 'station';
    this.currentStationId = station.id;
    this.selectedTargetValue = null;
    this.navigationBeaconValue = null;
    this.approachAssistEnabled = false;
    this.setAutopilot(false, true);
    this.dockingSeconds = 0;
    this.events.push({ type: 'DockingCompleted', tick: this.tick });
  }

  private isDockingEligible(): boolean {
    if (this.selectedTargetValue?.kind !== 'station' || this.entities.drones.size > 0) {
      return false;
    }
    const station = this.getSelectedStation();
    if (station === null) {
      return false;
    }
    const centreDistance = distance(this.ship.transform.position, station.transform.position);
    const relativeSpeed = length(subtract(this.ship.velocity.linear, station.velocity.linear));
    return centreDistance <= this.config.station.dockingDistance
      && relativeSpeed < this.config.station.dockingMaxRelativeSpeed
      && this.ship.hull > 0;
  }

  private resetDockingProgress(): void {
    this.dockingSeconds = 0;
    this.dockingAnnounced = false;
  }

  private resolveAsteroidImpacts(impacts: readonly AsteroidImpact[]): void {
    for (const impact of impacts) {
      const first = this.entities.asteroids.get(impact.firstId);
      const second = this.entities.asteroids.get(impact.secondId);
      if (first === undefined || second === undefined) {
        continue;
      }
      const candidates = [first, second]
        .filter((asteroid) => this.canFracture(asteroid))
        .sort((left, right) => this.fractureSusceptibility(right) - this.fractureSusceptibility(left));
      for (const candidate of candidates) {
        if (this.shouldFracture(candidate, impact.relativeSpeed)) {
          const normal = candidate.id === first.id ? scale(impact.normal, -1) : impact.normal;
          this.fragmentAsteroid(candidate, impact.relativeSpeed, normal, 'asteroid');
          break;
        }
      }
    }
  }

  private canFracture(asteroid: AsteroidEntity): boolean {
    return asteroid.collisionGraceSeconds <= 0
      && asteroid.radius >= this.config.asteroid.fragmentationMinParentRadius
      && asteroid.fragmentGeneration < this.config.asteroid.fragmentationMaxGeneration
      && this.entities.asteroids.size < this.config.asteroid.fragmentationMaxAsteroids;
  }

  private fractureSusceptibility(asteroid: AsteroidEntity): number {
    const materialFactor = asteroid.materialClass === 'icy'
      ? 1.22
      : asteroid.materialClass === 'carbonaceous'
        ? 1.08
        : 0.72;
    return materialFactor * (0.38 + (1 - asteroid.stability) * 0.82);
  }

  private shouldFracture(asteroid: AsteroidEntity, relativeSpeed: number): boolean {
    if (!this.canFracture(asteroid) || relativeSpeed < this.config.asteroid.fragmentationMinRelativeSpeed) {
      return false;
    }
    const effectiveSpeed = relativeSpeed * this.fractureSusceptibility(asteroid);
    const damageScale = (
      this.config.asteroid.fragmentationGuaranteedSpeed
      - this.config.asteroid.fragmentationMinRelativeSpeed
    ) / 3;
    const impactDamage = Math.max(
      0,
      ((effectiveSpeed - this.config.asteroid.fragmentationMinRelativeSpeed) / damageScale) ** 1.15,
    );
    asteroid.structuralIntegrity = Math.max(0, asteroid.structuralIntegrity - impactDamage);
    return asteroid.structuralIntegrity <= 0;
  }

  private fragmentAsteroid(
    parent: AsteroidEntity,
    relativeSpeed: number,
    impactNormal: Vector2,
    cause: 'ship' | 'asteroid',
  ): AsteroidEntity[] {
    if (!this.canFracture(parent)) {
      return [];
    }
    const random = new SeededRandom(parent.seed ^ Math.imul(this.tick + 17, 0x45d9f3b));
    const availableSlots = this.config.asteroid.fragmentationMaxAsteroids
      - this.entities.asteroids.size
      + 1;
    const requestedCount = random.next() < 0.46 ? 3 : 2;
    const fragmentCount = Math.max(2, Math.min(requestedCount, availableSlots));
    if (fragmentCount < 2) {
      return [];
    }

    const weights = Array.from({ length: fragmentCount }, () => random.range(0.72, 1.28));
    const weightTotal = weights.reduce((total, weight) => total + weight, 0);
    const retainedYield = parent.remainingYield * this.config.asteroid.fragmentationResourceRetention;
    const retainedMaximum = parent.maximumYield * this.config.asteroid.fragmentationResourceRetention;
    const baseAngle = Math.atan2(impactNormal.y, impactNormal.x);
    const ejectionSpeed = Math.min(4.4, 0.42 + relativeSpeed * 0.13);
    const wasSelected = this.selectedTargetValue?.kind === 'asteroid'
      && this.selectedTargetValue.id === parent.id;

    this.entities.asteroids.delete(parent.id);
    const fragments: AsteroidEntity[] = [];
    for (let index = 0; index < fragmentCount; index += 1) {
      const weight = (weights[index] ?? 1) / weightTotal;
      const radius = Math.max(5.2, Math.sqrt(parent.radius ** 2 * 0.9 * weight));
      const angle = baseAngle + (index / fragmentCount) * Math.PI * 2 + random.range(-0.18, 0.18);
      const radial = vector(Math.cos(angle), Math.sin(angle));
      const position = add(parent.transform.position, scale(radial, radius * 1.18));
      const inheritedVelocity = add(
        parent.velocity.linear,
        scale(radial, ejectionSpeed * random.range(0.72, 1.08)),
      );
      const seed = Math.abs(parent.seed ^ Math.imul(index + 1, 0x27d4eb2d) ^ this.tick);
      const spriteIndex = random.integer(0, 3);
      const fragment = this.spawnAsteroid({
        position,
        velocity: inheritedVelocity,
        radius,
        spin: parent.velocity.angular + random.range(-0.28, 0.28),
        seed,
        spriteIndex,
        name: `${parent.name}.${String.fromCharCode(65 + index)}`,
        materialClass: parent.materialClass,
        shapeClass: this.shapeForIndex(spriteIndex),
        resourceType: parent.resourceType,
        resourceTier: parent.resourceTier,
        remainingYield: retainedYield * weight,
        stability: Math.min(0.96, Math.max(0.12, parent.stability * 0.82 + random.range(-0.06, 0.05))),
        fragmentGeneration: parent.fragmentGeneration + 1,
        collisionGraceSeconds: this.config.asteroid.fragmentationGraceSeconds,
      });
      fragment.maximumYield = retainedMaximum * weight;
      fragments.push(fragment);
    }

    if (wasSelected && fragments.length > 0) {
      const primary = [...fragments].sort((left, right) => right.radius - left.radius)[0];
      if (primary !== undefined) {
        this.selectedTargetValue = { kind: 'asteroid', id: primary.id };
        this.setApproachAssist(false);
        this.miningSystem.onTargetChanged(primary.id, this.entities);
      }
    }
    this.events.push({
      type: 'AsteroidFractured',
      tick: this.tick,
      asteroidId: parent.id,
      fragmentIds: fragments.map((fragment) => fragment.id),
      retainedYield,
      cause,
    });
    return fragments;
  }

  private structuralIntegrityFor(
    sizeClass: AsteroidEntity['sizeClass'],
    materialClass: AsteroidEntity['materialClass'],
  ): number {
    const materialMultiplier = materialClass === 'rocky'
      ? 1.35
      : materialClass === 'metallic'
        ? 1.2
        : materialClass === 'icy'
          ? 0.72
          : 0.9;
    return this.config.asteroid.structuralIntegrity[sizeClass] * materialMultiplier;
  }

  private spawnMiningDebris(asteroid: AsteroidEntity): void {
    if (this.entities.debris.size >= 28) {
      return;
    }
    this.debrisSequence += 1;
    const random = new SeededRandom(
      asteroid.seed ^ Math.imul(this.tick + this.debrisSequence * 97, 0x45d9f3b),
    );
    const fragmentCount = random.next() > 0.72 ? 2 : 1;
    for (let index = 0; index < fragmentCount; index += 1) {
      const angle = random.range(0, Math.PI * 2);
      const radial = vector(Math.cos(angle), Math.sin(angle));
      const tangent = vector(-radial.y, radial.x);
      const speed = random.range(
        this.config.mining.debrisMinSpeed,
        this.config.mining.debrisMaxSpeed,
      );
      const position = add(asteroid.transform.position, scale(radial, asteroid.radius + 1.5));
      const velocity = add(
        asteroid.velocity.linear,
        add(scale(radial, speed), scale(tangent, random.range(-0.55, 0.55))),
      );
      this.entities.addDebris({
        kind: 'debris',
        transform: {
          position,
          previousPosition: { ...position },
          heading: random.range(-Math.PI, Math.PI),
          previousHeading: random.range(-Math.PI, Math.PI),
        },
        velocity: {
          linear: velocity,
          angular: random.range(-1.8, 1.8),
        },
        collider: { radius: random.range(1.1, 2.1) },
        sourceAsteroidId: asteroid.id,
        lifetimeSeconds: this.config.mining.debrisLifetimeSeconds,
        spriteIndex: random.integer(0, 5),
      });
    }
  }

  private createBeltAsteroidPosition(
    random: SeededRandom,
    radius: number,
    zone: 'lower-left' | 'centre' | 'upper-right',
  ): Vector2 {
    const stationClearance = this.config.station.radius
      + radius
      + this.config.station.asteroidExclusionPadding;
    const playerClearance = this.config.ship.radius
      + radius
      + this.config.asteroid.playerSpawnExclusionPadding;
    const diagonalScale = Math.SQRT1_2;

    for (let attempt = 0; attempt < this.config.asteroid.spawnPlacementAttempts; attempt += 1) {
      const alongBelt = zone === 'centre'
        ? random.range(-820, 820)
        : zone === 'lower-left'
          ? random.range(-2_180, -720)
          : random.range(720, 2_180);
      const halfWidth = zone === 'centre' ? 720 : 520;
      const acrossBelt = random.range(-halfWidth, halfWidth);
      const candidate = vector(
        alongBelt + acrossBelt * diagonalScale,
        -alongBelt + acrossBelt * diagonalScale,
      );
      if (
        Math.abs(candidate.x) + radius <= this.config.sectorHalfExtent
        && Math.abs(candidate.y) + radius <= this.config.sectorHalfExtent
        &&
        [...this.entities.stations.values()].every((station) =>
          distance(candidate, station.transform.position) >= stationClearance)
        && distance(candidate, this.ship.transform.position) >= playerClearance
        && [...this.entities.asteroids.values()].every((asteroid) =>
          distance(candidate, asteroid.transform.position)
            >= radius + asteroid.radius + this.config.asteroid.asteroidSpawnPadding)
      ) {
        return candidate;
      }
    }

    throw new Error(`Unable to place ${zone} belt asteroid with radius ${radius.toFixed(1)} m.`);
  }

  private createShip(): ShipEntity {
    const shipConfig = this.config.ship;
    const cargo = createEmptyCargo();
    const ship = this.entities.setShip({
      kind: 'ship',
      transform: {
        position: vector(this.config.station.dockedShipX, this.config.station.dockedShipY),
        previousPosition: vector(this.config.station.dockedShipX, this.config.station.dockedShipY),
        heading: 0,
        previousHeading: 0,
      },
      velocity: {
        linear: vector(),
        angular: 0,
      },
      collider: { radius: shipConfig.radius },
      dryMass: shipConfig.dryMass,
      cargo,
      cargoMass: calculateCargoMass(cargo),
      cargoCapacity: shipConfig.cargoCapacity,
      hull: shipConfig.maxHull,
      maxHull: shipConfig.maxHull,
      fuel: shipConfig.initialFuel,
      fuelCapacity: shipConfig.fuelCapacity,
      forwardThrust: shipConfig.forwardThrust,
      reverseThrust: shipConfig.reverseThrust,
      rotationalAcceleration: shipConfig.rotationalAcceleration,
      maxAngularSpeed: shipConfig.maxAngularSpeed,
      fuelUseMultiplier: 1,
      dronesAboard: shipConfig.startingDrones,
      maxDrones: shipConfig.startingDrones,
      installedModules: [],
      hardpoints: {
        port: { moduleId: null, condition: 100 },
        starboard: { moduleId: null, condition: 100 },
        ventral: { moduleId: null, condition: 100 },
      },
    });
    this.applyLoadout(this.installedModules);
    return ship;
  }

  private createStations(): void {
    const stations = navigationDestinations.filter((destination) => destination.kind === 'station');
    for (const [index, destination] of stations.entries()) {
      const position = vector(destination.position.x, destination.position.y);
      const definition: Omit<StationEntity, 'id'> = {
        kind: 'station',
        destinationId: destination.id,
        code: destination.code,
        transform: {
          position,
          previousPosition: { ...position },
          heading: index === 0 ? 0 : Math.PI / 4,
          previousHeading: index === 0 ? 0 : Math.PI / 4,
        },
        velocity: {
          linear: vector(),
          angular: 0,
        },
        collider: { radius: this.config.station.radius },
        name: destination.name,
      };
      if (index === 0) {
        this.entities.setStation(definition);
      } else {
        this.entities.addStation(definition);
      }
    }
    if (this.entities.station === null) {
      throw new Error('Navigation data must define at least one station.');
    }
  }

  private createTrader(): void {
    const stations = [...this.entities.stations.values()];
    const origin = stations.find((station) => station.destinationId === 'ceres-relay') ?? stations[0];
    const destination = stations.find((station) => station.id !== origin?.id);
    if (origin === undefined || destination === undefined) {
      return;
    }
    const position = this.traderSystem.getDockPosition(origin);
    this.entities.addTrader({
      kind: 'trader',
      name: 'Free Trader Lark',
      code: 'FT-LARK 07',
      transform: {
        position,
        previousPosition: { ...position },
        heading: Math.PI,
        previousHeading: Math.PI,
      },
      velocity: {
        linear: vector(),
        angular: 0,
      },
      collider: { radius: this.config.trader.radius },
      state: 'docked',
      currentStationId: origin.id,
      destinationStationId: destination.id,
      dockingSecondsRemaining: this.config.trader.dockingSeconds,
      replanSecondsRemaining: 0,
      route: [],
    });
  }

  private createAsteroidField(seed: number): void {
    const random = new SeededRandom(seed);

    this.spawnAsteroid({
      position: vector(0, 850),
      velocity: vector(0.24, -0.14),
      radius: this.config.asteroid.baseVerySmallRadius * this.config.asteroid.sizeScale.small,
      spin: 0.055,
      seed: 1001,
      spriteIndex: 2,
      name: 'M-12 Kestrel Rock',
      materialClass: 'metallic',
      sizeClass: 'small',
      resourceType: 'industrial',
      resourceTier: 'standard',
      remainingYield: 24,
      stability: 0.88,
    });
    this.spawnAsteroid({
      position: vector(-1450, 1450),
      velocity: vector(2.1, -1.7),
      radius: this.config.asteroid.baseVerySmallRadius * this.config.asteroid.sizeScale['very-small'],
      spin: -0.07,
      seed: 1002,
      spriteIndex: 0,
      name: 'I-07 Helix Lantern',
      materialClass: 'icy',
      sizeClass: 'very-small',
      resourceType: 'water',
      resourceTier: 'exceptional',
      remainingYield: 20,
      stability: 0.77,
    });
    this.spawnAsteroid({
      position: vector(1450, -1450),
      velocity: vector(-1.9, 2.2),
      radius: this.config.asteroid.baseVerySmallRadius * this.config.asteroid.sizeScale.medium,
      spin: 0.038,
      seed: 1003,
      spriteIndex: 3,
      name: 'R-03 Black Dividend',
      materialClass: 'carbonaceous',
      sizeClass: 'medium',
      resourceType: 'rare',
      resourceTier: 'exceptional',
      remainingYield: 96,
      stability: 0.48,
    });

    this.spawnAsteroid({
      position: vector(-950, 850),
      velocity: vector(1.55, -1.25),
      radius: this.config.asteroid.baseVerySmallRadius * this.config.asteroid.sizeScale.large,
      spin: -0.018,
      seed: 1004,
      spriteIndex: 1,
      name: 'RK-01 Shieldwall',
      materialClass: 'rocky',
      sizeClass: 'large',
      resourceType: 'none',
      resourceTier: 'trace',
      remainingYield: 0,
      stability: 0.68,
    });

    this.spawnAsteroid({
      position: vector(1000, -1050),
      velocity: vector(-1.35, 1.6),
      radius: this.config.asteroid.baseVerySmallRadius * this.config.asteroid.sizeScale['very-large'],
      spin: 0.006,
      seed: 1005,
      spriteIndex: 0,
      name: 'RK-VL Atlas Massif',
      materialClass: 'rocky',
      sizeClass: 'very-large',
      resourceType: 'none',
      resourceTier: 'trace',
      remainingYield: 0,
      stability: 0.76,
    });

    const remainingCount = Math.max(0, this.config.asteroid.count - 5);
    for (let index = 0; index < remainingCount; index += 1) {
      const zone = index < Math.floor(remainingCount * 0.31)
        ? 'centre'
        : index % 2 === 0
          ? 'lower-left'
          : 'upper-right';
      const violent = zone !== 'centre';
      const sizeClass = violent
        ? this.rollCornerAsteroidSize(random.next())
        : this.rollCentralAsteroidSize(random.next());
      const radius = this.radiusForSizeClass(sizeClass, random);
      const position = this.createBeltAsteroidPosition(random, radius, zone);
      const velocityVariation = violent ? 2.7 : 0.95;
      const velocity = vector(
        this.config.asteroid.meanDriftX + random.range(
          -velocityVariation,
          velocityVariation,
        ),
        this.config.asteroid.meanDriftY + random.range(
          -velocityVariation,
          velocityVariation,
        ),
      );
      const spinScale = violent ? 1.25 : 0.55;
      const spin = random.range(
        this.config.asteroid.minSpin * spinScale,
        this.config.asteroid.maxSpin * spinScale,
      );
      const barren = random.next() < (violent ? 0.58 : 0.78);
      const materialClass = barren
        ? 'rocky'
        : random.pick<AsteroidEntity['materialClass']>([
            'carbonaceous',
            'carbonaceous',
            'icy',
            'metallic',
          ]);
      const resourceType = this.resourceForMaterial(materialClass, random.next());
      const resourceTier = resourceType === 'none'
        ? 'trace'
        : violent
          ? this.rollResourceTier(random.range(0.58, 0.999))
          : this.rollResourceTier(random.next());
      const asteroidSeed = random.integer(1, 2_000_000_000);

      this.spawnAsteroid({
        position,
        velocity,
        radius,
        spin,
        seed: asteroidSeed,
        spriteIndex: random.integer(0, 3),
        name: `${materialClass === 'rocky'
          ? 'RK'
          : materialClass === 'icy'
            ? 'I'
            : materialClass === 'metallic'
              ? 'M'
              : 'C'}-${asteroidSeed % 997}`,
        materialClass,
        sizeClass,
        resourceType,
        resourceTier,
        remainingYield: resourceType === 'none'
          ? 0
          : Math.max(
              3,
              radius * resourceTierDefinitions[resourceTier].yieldMultiplier * random.range(0.88, 1.12),
            ),
        stability: violent ? random.range(0.25, 0.76) : random.range(0.62, 0.96),
      });
    }
  }

  private rollCentralAsteroidSize(roll: number): AsteroidEntity['sizeClass'] {
    if (roll < 0.50) {
      return 'very-small';
    }
    if (roll < 0.83) {
      return 'small';
    }
    if (roll < 0.97) {
      return 'medium';
    }
    return 'large';
  }

  private rollCornerAsteroidSize(roll: number): AsteroidEntity['sizeClass'] {
    if (roll < 0.14) {
      return 'very-small';
    }
    if (roll < 0.38) {
      return 'small';
    }
    if (roll < 0.69) {
      return 'medium';
    }
    if (roll < 0.94) {
      return 'large';
    }
    return 'large';
  }

  private resourceForMaterial(
    materialClass: AsteroidEntity['materialClass'],
    rareRoll = 1,
  ): AsteroidResourceType {
    if (materialClass === 'rocky') {
      return 'none';
    }
    if (rareRoll < 0.08) {
      return 'rare';
    }
    if (materialClass === 'icy') {
      return 'water';
    }
    return 'industrial';
  }

  private rollResourceTier(roll: number): ResourceTier {
    if (roll < 0.24) {
      return 'trace';
    }
    if (roll < 0.70) {
      return 'standard';
    }
    if (roll < 0.93) {
      return 'rich';
    }
    return 'exceptional';
  }

  private radiusForSizeClass(
    sizeClass: AsteroidEntity['sizeClass'],
    random: SeededRandom,
  ): number {
    const scaleFactor = this.config.asteroid.sizeScale[sizeClass];
    const variation = random.range(
      -this.config.asteroid.sizeVariation,
      this.config.asteroid.sizeVariation,
    );
    return this.config.asteroid.baseVerySmallRadius * scaleFactor * (1 + variation);
  }

  private sizeClassForRadius(radius: number): AsteroidEntity['sizeClass'] {
    const verySmallRadius = this.config.asteroid.baseVerySmallRadius
      * this.config.asteroid.sizeScale['very-small'];
    const smallRadius = this.config.asteroid.baseVerySmallRadius * this.config.asteroid.sizeScale.small;
    const mediumRadius = this.config.asteroid.baseVerySmallRadius * this.config.asteroid.sizeScale.medium;
    const largeRadius = this.config.asteroid.baseVerySmallRadius * this.config.asteroid.sizeScale.large;
    const veryLargeRadius = this.config.asteroid.baseVerySmallRadius
      * this.config.asteroid.sizeScale['very-large'];
    if (radius < (verySmallRadius + smallRadius) / 2) {
      return 'very-small';
    }
    if (radius < (smallRadius + mediumRadius) / 2) {
      return 'small';
    }
    if (radius < (mediumRadius + largeRadius) / 2) {
      return 'medium';
    }
    if (radius < (largeRadius + veryLargeRadius) / 2) {
      return 'large';
    }
    return 'very-large';
  }

  private shapeForIndex(index: number): AsteroidEntity['shapeClass'] {
    switch (Math.abs(index) % 4) {
      case 1:
        return 'shard';
      case 2:
        return 'rubble';
      case 3:
        return 'wedge';
      default:
        return 'boulder';
    }
  }

  private getTutorialAsteroid(): AsteroidEntity | null {
    for (const asteroid of this.entities.asteroids.values()) {
      if (asteroid.seed === 1001) {
        return asteroid;
      }
    }
    return this.entities.asteroids.values().next().value ?? null;
  }

  private getContextActionLabel(target: TargetSnapshot | null): string {
    if (this.entities.drones.size > 0) {
      return 'RECALL';
    }
    if (this.autopilotEnabled) {
      return 'AUTO ACTIVE';
    }
    if (target !== null) {
      if (target.kind === 'station' && this.dockingSeconds > 0) {
        return `DOCK ${Math.round((this.dockingSeconds / this.config.station.dockingStabilizeSeconds) * 100)}%`;
      }
      return this.approachAssistEnabled
        ? 'ASSIST ON'
        : this.flightAssistInstalled
          ? 'ASSIST'
          : 'ASSIST LOCKED';
    }
    return 'TARGET';
  }

  private getObjective(target: TargetSnapshot | null, miningStatus: MiningStatus): string {
    if (this.phase === 'station') {
      return this.installedModules.length > 0
        ? 'Upgrade installed. Launch to use the fitted ship system.'
        : this.ship.cargoMass > 0
          ? 'Sell the returned cargo, then install a ship upgrade.'
          : 'Launch, lock M-12 Kestrel Rock, and recover one drone load.';
    }
    if (this.phase === 'disabled') {
      return 'Ship disabled. Emergency tow is required.';
    }
    if (this.autopilotEnabled && this.navigationBeaconValue !== null) {
      const mode = this.autopilotTelemetry.status === 'avoidance'
        ? 'Avoidance route active'
        : 'Optimal route active';
      return `${mode} to ${this.navigationBeaconValue.name}. Manual thrust cancels autopilot.`;
    }
    if (target === null) {
      return this.ship.cargoMass > 0
        ? this.navigationBeaconValue === null
          ? 'Cargo aboard. Open NAV and select a station.'
          : this.flightAssistInstalled
            ? `Autopilot standing by for ${this.navigationBeaconValue.name}. Reselect it in NAV to engage.`
            : `Navigation beacon active for ${this.navigationBeaconValue.name}. Fly the pointer manually.`
        : 'Tap an asteroid to select it. M-12 is the marked training target.';
    }
    if (target.kind === 'station') {
      if (this.entities.drones.size > 0) {
        return 'Recall all drones before docking.';
      }
      if (this.dockingSeconds > 0) {
        return 'Hold below 2.5 m/s while docking clamps stabilize.';
      }
      return 'Approach the station beacon and match its zero velocity.';
    }
    if (target.kind === 'trader') {
      return this.navigationBeaconValue?.kind === 'trader'
        ? 'Independent ship tracked. Follow the plotted route manually or engage Wayfinder.'
        : 'Independent ship selected.';
    }
    if (target.resourceLabel === 'Barren rock') {
      return 'Barren rock. No recoverable resources detected.';
    }
    if (miningStatus === 'stabilizing') {
      return 'Mining envelope stable. Hold position while drones arm.';
    }
    if (miningStatus === 'launching' || miningStatus === 'mining') {
      return 'Drones active. Maintain the envelope; cargo counts only on return.';
    }
    if (miningStatus === 'paused') {
      return `Extraction paused. Move inside ${this.config.mining.distanceFromSurface} m and below ${this.config.mining.armRelativeSpeed.toFixed(1)} m/s relative speed.`;
    }
    if (miningStatus === 'recalling') {
      return 'Drones returning. Wait for them to reach the ship.';
    }
    if (target.distanceToSurface <= this.config.mining.distanceFromSurface + 20) {
      return target.relativeSpeed >= this.config.mining.armRelativeSpeed
        ? `Use lateral or main thrust to reduce relative speed below ${this.config.mining.armRelativeSpeed.toFixed(1)} m/s.`
        : `Move inside the ${this.config.mining.distanceFromSurface} m mining envelope and hold steady.`;
    }
    return this.flightAssistInstalled
      ? 'Use ASSIST or manual thrust to approach the selected asteroid.'
      : 'Approach manually. Flight assist is available from the station shipyard.';
  }
}
