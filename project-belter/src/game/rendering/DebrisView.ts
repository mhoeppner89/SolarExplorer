import type Phaser from 'phaser';
import { assetManifest } from '../../assets/manifest';
import type { DebrisEntity } from '../simulation/components';
import type { InterpolatedTransform } from '../simulation/GameSimulation';

export class DebrisView {
  public readonly container: Phaser.GameObjects.Container;

  public constructor(scene: Phaser.Scene, debris: DebrisEntity) {
    this.container = scene.add.container(0, 0).setDepth(28);
    const size = debris.collider.radius * 4.2;
    const body = scene.add.image(0, 0, assetManifest.debris[0]).setDisplaySize(size, size);
    this.container.add(body);
  }

  public update(_debris: DebrisEntity, transform: InterpolatedTransform): void {
    this.container.setPosition(transform.position.x, transform.position.y);
    this.container.setRotation(transform.heading);
  }

  public destroy(): void {
    this.container.destroy(true);
  }
}
