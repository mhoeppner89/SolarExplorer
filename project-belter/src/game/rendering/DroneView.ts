import type Phaser from 'phaser';
import { assetManifest } from '../../assets/manifest';
import type { DroneEntity } from '../simulation/components';
import type { InterpolatedTransform } from '../simulation/GameSimulation';

export class DroneView {
  public readonly container: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Image;
  private readonly beacon: Phaser.GameObjects.Ellipse;
  private readonly cargoGlow: Phaser.GameObjects.Ellipse;
  private readonly thrusterGlow: Phaser.GameObjects.Ellipse;

  public constructor(scene: Phaser.Scene) {
    this.container = scene.add.container(0, 0).setDepth(45);
    this.beacon = scene.add.ellipse(0, 0, 15, 15)
      .setStrokeStyle(0.65, 0x6de7dd, 0.5);
    this.thrusterGlow = scene.add.ellipse(0, 5.5, 2.4, 4, 0x8ff7ff, 0.58);
    this.cargoGlow = scene.add.ellipse(0, 0.5, 8, 8, 0xffb45f, 0);
    this.body = scene.add.image(0, 0, assetManifest.drones[0]).setDisplaySize(13, 13);
    this.container.add([this.beacon, this.thrusterGlow, this.cargoGlow, this.body]);
  }

  public update(drone: DroneEntity, transform: InterpolatedTransform): void {
    this.container.setPosition(transform.position.x, transform.position.y);
    this.container.setRotation(transform.heading);
    const paused = drone.state === 'paused';
    const inTransit = drone.state === 'launching'
      || drone.state === 'returning'
      || drone.state === 'berthing';
    this.body.setAlpha(paused ? 0.62 : 1);
    this.beacon.setAlpha(paused ? 0.28 : 0.55);
    this.thrusterGlow.setAlpha(inTransit ? 0.62 : 0.12);
    this.cargoGlow.setAlpha(drone.carriedAmount > 0 ? 0.44 : 0);
  }

  public destroy(): void {
    this.container.destroy(true);
  }
}
