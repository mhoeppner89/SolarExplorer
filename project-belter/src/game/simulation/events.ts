import type { ResourceType } from '../../data/gameData';
import type { EntityId } from './components';
import type { HardpointId } from './components';
import type { ModuleId } from '../../data/gameData';
import type { Vector2 } from './Vector2';

export type CollisionSeverity = 'safe' | 'minor' | 'serious' | 'severe';

export interface CollisionOccurredEvent {
  type: 'CollisionOccurred';
  tick: number;
  objectId: EntityId;
  objectKind: 'asteroid' | 'debris' | 'trader';
  relativeSpeed: number;
  closingSpeed: number;
  damage: number;
  severity: CollisionSeverity;
  normal: Vector2;
}

export interface ShipDisabledEvent {
  type: 'ShipDisabled';
  tick: number;
}

export interface TargetSelectedEvent {
  type: 'TargetSelected';
  tick: number;
  targetKind: 'asteroid' | 'station' | 'trader';
  targetId: EntityId;
  name: string;
}

export interface TargetClearedEvent {
  type: 'TargetCleared';
  tick: number;
}

export interface AssistChangedEvent {
  type: 'AssistChanged';
  tick: number;
  enabled: boolean;
}

export interface AutopilotChangedEvent {
  type: 'AutopilotChanged';
  tick: number;
  enabled: boolean;
  arrived: boolean;
}

export interface EquipmentDamagedEvent {
  type: 'EquipmentDamaged';
  tick: number;
  hardpoint: HardpointId;
  moduleId: ModuleId;
  condition: number;
  disabled: boolean;
}

export interface DroneLaunchedEvent {
  type: 'DroneLaunched';
  tick: number;
  droneId: EntityId;
}

export interface CargoDeliveredEvent {
  type: 'CargoDelivered';
  tick: number;
  resource: ResourceType;
  amount: number;
}

export interface MiningStateChangedEvent {
  type: 'MiningStateChanged';
  tick: number;
  status: string;
}

export interface AsteroidDepletedEvent {
  type: 'AsteroidDepleted';
  tick: number;
  asteroidId: EntityId;
}

export interface AsteroidFracturedEvent {
  type: 'AsteroidFractured';
  tick: number;
  asteroidId: EntityId;
  fragmentIds: EntityId[];
  retainedYield: number;
  cause: 'ship' | 'asteroid';
}

export interface DockingStartedEvent {
  type: 'DockingStarted';
  tick: number;
}

export interface DockingCompletedEvent {
  type: 'DockingCompleted';
  tick: number;
}

export interface LaunchCompletedEvent {
  type: 'LaunchCompleted';
  tick: number;
}

export type SimulationEvent =
  | CollisionOccurredEvent
  | ShipDisabledEvent
  | TargetSelectedEvent
  | TargetClearedEvent
  | AssistChangedEvent
  | AutopilotChangedEvent
  | EquipmentDamagedEvent
  | DroneLaunchedEvent
  | CargoDeliveredEvent
  | MiningStateChangedEvent
  | AsteroidDepletedEvent
  | AsteroidFracturedEvent
  | DockingStartedEvent
  | DockingCompletedEvent
  | LaunchCompletedEvent;
