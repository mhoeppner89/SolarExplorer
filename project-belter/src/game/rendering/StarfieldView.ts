import type Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { SeededRandom } from '../simulation/SeededRandom';

export class StarfieldView {
  private readonly layers: Phaser.GameObjects.Graphics[] = [];

  public constructor(scene: Phaser.Scene) {
    this.layers.push(this.createLayer(scene, 0x7b8d95, 0.18, 180, 0.22, -100));
    this.layers.push(this.createLayer(scene, 0xa8c6cc, 0.36, 105, 0.48, -90));
    this.layers.push(this.createLayer(scene, 0xe3f9f7, 0.64, 48, 0.72, -80));
  }

  public destroy(): void {
    for (const layer of this.layers) {
      layer.destroy();
    }
  }

  private createLayer(
    scene: Phaser.Scene,
    color: number,
    alpha: number,
    count: number,
    scrollFactor: number,
    depth: number,
  ): Phaser.GameObjects.Graphics {
    const random = new SeededRandom(0x51a7 + count * 17);
    const graphics = scene.add.graphics().setDepth(depth).setScrollFactor(scrollFactor);
    graphics.fillStyle(color, alpha);
    const extent = tuning.sectorHalfExtent * 1.25;
    for (let index = 0; index < count; index += 1) {
      const x = random.range(-extent, extent);
      const y = random.range(-extent, extent);
      const radius = random.range(0.25, 0.85);
      graphics.fillCircle(x, y, radius);
    }
    return graphics;
  }
}
