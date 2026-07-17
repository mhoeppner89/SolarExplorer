import type { AsteroidResourceType, ModuleId, ResourceTier, ResourceType } from '../../data/gameData';
import type { CargoManifest } from '../../progression/CareerState';
import type { Vector2 } from './Vector2';

export type EntityId = number;
export type HardpointId = 'port' | 'starboard' | 'ventral';
export const hardpointIds: readonly HardpointId[] = ['port', 'starboard', 'ventral'];

export interface HardpointEquipmentState {
  moduleId: ModuleId | null;
  condition: number;
}

export interface TransformComponent {
  position: Vector2;
  previousPosition: Vector2;
  heading: number;
  previousHeading: number;
}

export interface VelocityComponent {
  linear: Vector2;
  angular: number;
}

export interface CircleColliderComponent {
  radius: number;
}

export interface ShipEntity {
  id: EntityId;
  kind: 'ship';
  transform: TransformComponent;
  velocity: VelocityComponent;
  collider: CircleColliderComponent;
  dryMass: number;
  cargo: CargoManifest;
  cargoMass: number;
  cargoCapacity: number;
  hull: number;
  maxHull: number;
  fuel: number;
  fuelCapacity: number;
  forwardThrust: number;
  reverseThrust: number;
  rotationalAcceleration: number;
  maxAngularSpeed: number;
  fuelUseMultiplier: number;
  dronesAboard: number;
  maxDrones: number;
  installedModules: ModuleId[];
  hardpoints: Record<HardpointId, HardpointEquipmentState>;
}

export interface AsteroidEntity {
  id: EntityId;
  kind: 'asteroid';
  transform: TransformComponent;
  velocity: VelocityComponent;
  collider: CircleColliderComponent;
  radius: number;
  seed: number;
  spriteIndex: number;
  name: string;
  materialClass: 'rocky' | 'carbonaceous' | 'metallic' | 'icy';
  shapeClass: 'boulder' | 'shard' | 'rubble' | 'wedge';
  sizeClass: 'very-small' | 'small' | 'medium' | 'large' | 'very-large';
  resourceType: AsteroidResourceType;
  resourceTier: ResourceTier;
  remainingYield: number;
  maximumYield: number;
  stability: number;
  structuralIntegrity: number;
  maximumStructuralIntegrity: number;
  fragmentGeneration: number;
  collisionGraceSeconds: number;
}

export type DroneState = 'launching' | 'extracting' | 'paused' | 'returning' | 'unloading' | 'berthing';

export interface DroneEntity {
  id: EntityId;
  kind: 'drone';
  transform: TransformComponent;
  velocity: VelocityComponent;
  collider: CircleColliderComponent;
  droneIndex: number;
  spriteIndex: number;
  state: DroneState;
  targetAsteroidId: EntityId;
  surfaceAngle: number;
  extractionSeconds: number;
  carriedResource: ResourceType;
  carriedAmount: number;
  launchDelaySeconds: number;
  assignedHardpoint: HardpointId;
  unloadSeconds: number;
}

export interface DebrisEntity {
  id: EntityId;
  kind: 'debris';
  transform: TransformComponent;
  velocity: VelocityComponent;
  collider: CircleColliderComponent;
  sourceAsteroidId: EntityId;
  lifetimeSeconds: number;
  spriteIndex: number;
}

export interface StationEntity {
  id: EntityId;
  kind: 'station';
  destinationId: string;
  code: string;
  transform: TransformComponent;
  velocity: VelocityComponent;
  collider: CircleColliderComponent;
  name: string;
}

export type TraderState = 'docked' | 'traveling';

export interface TraderEntity {
  id: EntityId;
  kind: 'trader';
  name: string;
  code: string;
  transform: TransformComponent;
  velocity: VelocityComponent;
  collider: CircleColliderComponent;
  state: TraderState;
  currentStationId: EntityId;
  destinationStationId: EntityId;
  dockingSecondsRemaining: number;
  replanSecondsRemaining: number;
  route: Vector2[];
}

export type SimulationEntity =
  | ShipEntity
  | AsteroidEntity
  | DroneEntity
  | DebrisEntity
  | StationEntity
  | TraderEntity;

export const getShipMass = (ship: ShipEntity): number => ship.dryMass + ship.cargoMass;
