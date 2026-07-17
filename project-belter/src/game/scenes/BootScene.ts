import Phaser from 'phaser';
import { assetManifest } from '../../assets/manifest';

export class BootScene extends Phaser.Scene {
  public constructor() {
    super({ key: 'BootScene' });
  }

  public preload(): void {
    this.loadSprite(assetManifest.ship.base, './assets/sprites/ship_hauler_v1.png');
    this.loadSprite(assetManifest.ship.moduleEngine, './assets/sprites/module_engine_v2.png');
    this.loadSprite(assetManifest.ship.moduleRetro, './assets/sprites/module_retro_v2.png');
    this.loadSprite(assetManifest.ship.moduleCargo, './assets/sprites/module_cargo_v2.png');
    this.loadSprite(assetManifest.ship.moduleAssist, './assets/sprites/module_assist_v2.png');
    this.loadSprite(assetManifest.station, './assets/sprites/station_frontier_v2.png');
    assetManifest.asteroids.rocky.forEach((key, index) => {
      this.loadSprite(key, `./assets/sprites/asteroid_rocky_${index}_v1.png`);
    });
    assetManifest.asteroids.carbonaceous.forEach((key, index) => {
      this.loadSprite(key, `./assets/sprites/asteroid_carbon_${index}_v3.png`);
    });
    assetManifest.asteroids.icy.forEach((key, index) => {
      this.loadSprite(key, `./assets/sprites/asteroid_icy_${index}_v3.png`);
    });
    assetManifest.asteroids.metallic.forEach((key, index) => {
      this.loadSprite(key, `./assets/sprites/asteroid_metallic_${index}_v3.png`);
    });
    assetManifest.colossalAsteroids.carbonaceous.forEach((key, index) => {
      this.loadSprite(key, `./assets/sprites/asteroid_carbon_${index}_colossal_v1.png`);
    });
    assetManifest.colossalAsteroids.rocky.forEach((key, index) => {
      this.loadSprite(key, `./assets/sprites/asteroid_rocky_${index}_colossal_v1.png`);
    });
    assetManifest.colossalAsteroids.icy.forEach((key, index) => {
      this.loadSprite(key, `./assets/sprites/asteroid_icy_${index}_colossal_v1.png`);
    });
    assetManifest.colossalAsteroids.metallic.forEach((key, index) => {
      this.loadSprite(key, `./assets/sprites/asteroid_metallic_${index}_colossal_v1.png`);
    });
    this.loadSprite(assetManifest.drones[0], './assets/sprites/drone_miner_v3.png');
    this.loadSprite(assetManifest.debris[0], './assets/sprites/debris_fragment_v2.png');
  }

  public create(): void {
    this.scene.start('FlightScene');
  }

  private loadSprite(key: string, path: string): void {
    this.load.image(key, window.__BELTER_ASSET_DATA__?.[path] ?? path);
  }
}
