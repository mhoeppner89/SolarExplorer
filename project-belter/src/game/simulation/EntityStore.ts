import type {
  AsteroidEntity,
  DebrisEntity,
  DroneEntity,
  EntityId,
  ShipEntity,
  StationEntity,
  TraderEntity,
} from './components';

export class EntityStore {
  private nextId = 1;

  public ship: ShipEntity | null = null;
  public station: StationEntity | null = null;
  public readonly stations = new Map<EntityId, StationEntity>();
  public readonly asteroids = new Map<EntityId, AsteroidEntity>();
  public readonly drones = new Map<EntityId, DroneEntity>();
  public readonly debris = new Map<EntityId, DebrisEntity>();
  public readonly traders = new Map<EntityId, TraderEntity>();

  public allocateId(): EntityId {
    const id = this.nextId;
    this.nextId += 1;
    return id;
  }

  public setShip(ship: Omit<ShipEntity, 'id'>): ShipEntity {
    const entity: ShipEntity = { ...ship, id: this.allocateId() };
    this.ship = entity;
    return entity;
  }

  public setStation(station: Omit<StationEntity, 'id'>): StationEntity {
    const entity: StationEntity = { ...station, id: this.allocateId() };
    this.station = entity;
    this.stations.set(entity.id, entity);
    return entity;
  }

  public addStation(station: Omit<StationEntity, 'id'>): StationEntity {
    const entity: StationEntity = { ...station, id: this.allocateId() };
    this.stations.set(entity.id, entity);
    return entity;
  }

  public addAsteroid(asteroid: Omit<AsteroidEntity, 'id'>): AsteroidEntity {
    const entity: AsteroidEntity = { ...asteroid, id: this.allocateId() };
    this.asteroids.set(entity.id, entity);
    return entity;
  }

  public addDrone(drone: Omit<DroneEntity, 'id'>): DroneEntity {
    const entity: DroneEntity = { ...drone, id: this.allocateId() };
    this.drones.set(entity.id, entity);
    return entity;
  }

  public addDebris(debris: Omit<DebrisEntity, 'id'>): DebrisEntity {
    const entity: DebrisEntity = { ...debris, id: this.allocateId() };
    this.debris.set(entity.id, entity);
    return entity;
  }

  public addTrader(trader: Omit<TraderEntity, 'id'>): TraderEntity {
    const entity: TraderEntity = { ...trader, id: this.allocateId() };
    this.traders.set(entity.id, entity);
    return entity;
  }

  public clear(): void {
    this.nextId = 1;
    this.ship = null;
    this.station = null;
    this.stations.clear();
    this.asteroids.clear();
    this.drones.clear();
    this.debris.clear();
    this.traders.clear();
  }

  public get entityCount(): number {
    return Number(this.ship !== null)
      + this.stations.size
      + this.asteroids.size
      + this.drones.size
      + this.debris.size
      + this.traders.size;
  }
}
