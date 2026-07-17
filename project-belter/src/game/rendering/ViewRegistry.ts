import type Phaser from 'phaser';
import type { EntityId } from '../simulation/components';
import type { GameSimulation, SimulationDebugSnapshot } from '../simulation/GameSimulation';
import { AsteroidView } from './AsteroidView';
import { DebrisView } from './DebrisView';
import { DroneView } from './DroneView';
import { NavigationView } from './NavigationView';
import { ShipView } from './ShipView';
import { StationView } from './StationView';
import { TraderView } from './TraderView';
import { VelocityVectorView } from './VelocityVectorView';

export class ViewRegistry {
  public readonly shipView: ShipView;
  private readonly stationViews = new Map<EntityId, StationView>();
  private readonly asteroidViews = new Map<EntityId, AsteroidView>();
  private readonly droneViews = new Map<EntityId, DroneView>();
  private readonly debrisViews = new Map<EntityId, DebrisView>();
  private readonly traderViews = new Map<EntityId, TraderView>();
  private readonly velocityVector: VelocityVectorView;
  private readonly navigationView: NavigationView;

  public constructor(
    scene: Phaser.Scene,
    private readonly simulation: GameSimulation,
  ) {
    this.shipView = new ShipView(scene);
    this.velocityVector = new VelocityVectorView(scene);
    this.navigationView = new NavigationView(scene);
    this.syncViews(scene);
  }

  public update(
    scene: Phaser.Scene,
    interpolationAlpha: number,
    snapshot: SimulationDebugSnapshot,
  ): void {
    this.syncViews(scene);
    const shipTransform = this.simulation.getInterpolatedShip(interpolationAlpha);
    this.shipView.update(this.simulation.ship, shipTransform, snapshot.appliedActions, snapshot);
    this.velocityVector.update(this.simulation.ship, shipTransform);
    this.navigationView.update(snapshot);
    for (const station of this.simulation.entities.stations.values()) {
      this.stationViews.get(station.id)?.update(
        snapshot.target?.kind === 'station' && snapshot.target.id === station.id,
        snapshot.target?.kind === 'station' && snapshot.target.id === station.id
          ? snapshot.docking.progress
          : 0,
      );
    }

    for (const asteroid of this.simulation.entities.asteroids.values()) {
      const view = this.asteroidViews.get(asteroid.id);
      view?.update(
        asteroid,
        this.simulation.getInterpolatedAsteroid(asteroid, interpolationAlpha),
        snapshot.target?.kind === 'asteroid' && snapshot.target.id === asteroid.id,
      );
    }
    for (const drone of this.simulation.entities.drones.values()) {
      this.droneViews.get(drone.id)?.update(
        drone,
        this.simulation.getInterpolatedDrone(drone, interpolationAlpha),
      );
    }
    for (const debris of this.simulation.entities.debris.values()) {
      this.debrisViews.get(debris.id)?.update(
        debris,
        this.simulation.getInterpolatedDebris(debris, interpolationAlpha),
      );
    }
    for (const trader of this.simulation.entities.traders.values()) {
      this.traderViews.get(trader.id)?.update(
        trader,
        this.simulation.getInterpolatedTrader(trader, interpolationAlpha),
        snapshot.target?.kind === 'trader' && snapshot.target.id === trader.id,
      );
    }
  }

  public destroy(): void {
    this.shipView.destroy();
    for (const view of this.stationViews.values()) {
      view.destroy();
    }
    this.velocityVector.destroy();
    this.navigationView.destroy();
    for (const view of this.asteroidViews.values()) {
      view.destroy();
    }
    for (const view of this.droneViews.values()) {
      view.destroy();
    }
    for (const view of this.debrisViews.values()) {
      view.destroy();
    }
    for (const view of this.traderViews.values()) {
      view.destroy();
    }
    this.asteroidViews.clear();
    this.stationViews.clear();
    this.droneViews.clear();
    this.debrisViews.clear();
    this.traderViews.clear();
  }

  private syncViews(scene: Phaser.Scene): void {
    for (const station of this.simulation.entities.stations.values()) {
      if (!this.stationViews.has(station.id)) {
        this.stationViews.set(station.id, new StationView(scene, station));
      }
    }
    for (const [id, view] of this.stationViews) {
      if (!this.simulation.entities.stations.has(id)) {
        view.destroy();
        this.stationViews.delete(id);
      }
    }

    for (const asteroid of this.simulation.entities.asteroids.values()) {
      if (!this.asteroidViews.has(asteroid.id)) {
        this.asteroidViews.set(asteroid.id, new AsteroidView(scene, asteroid));
      }
    }
    for (const [id, view] of this.asteroidViews) {
      if (!this.simulation.entities.asteroids.has(id)) {
        view.destroy();
        this.asteroidViews.delete(id);
      }
    }

    for (const drone of this.simulation.entities.drones.values()) {
      if (!this.droneViews.has(drone.id)) {
        this.droneViews.set(drone.id, new DroneView(scene));
      }
    }
    for (const [id, view] of this.droneViews) {
      if (!this.simulation.entities.drones.has(id)) {
        view.destroy();
        this.droneViews.delete(id);
      }
    }

    for (const debris of this.simulation.entities.debris.values()) {
      if (!this.debrisViews.has(debris.id)) {
        this.debrisViews.set(debris.id, new DebrisView(scene, debris));
      }
    }
    for (const [id, view] of this.debrisViews) {
      if (!this.simulation.entities.debris.has(id)) {
        view.destroy();
        this.debrisViews.delete(id);
      }
    }

    for (const trader of this.simulation.entities.traders.values()) {
      if (!this.traderViews.has(trader.id)) {
        this.traderViews.set(trader.id, new TraderView(scene));
      }
    }
    for (const [id, view] of this.traderViews) {
      if (!this.simulation.entities.traders.has(id)) {
        view.destroy();
        this.traderViews.delete(id);
      }
    }
  }
}
