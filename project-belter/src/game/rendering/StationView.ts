import type Phaser from 'phaser';
import { assetManifest } from '../../assets/manifest';
import type { StationEntity } from '../simulation/components';

export class StationView {
  public readonly container: Phaser.GameObjects.Container;
  private readonly selection: Phaser.GameObjects.Graphics;
  private readonly dockingLights: Phaser.GameObjects.Graphics;
  private readonly selectionRadius: number;
  private readonly progressRadius: number;

  public constructor(scene: Phaser.Scene, station: StationEntity) {
    this.container = scene.add.container(station.transform.position.x, station.transform.position.y).setDepth(4);
    const shadow = scene.add.ellipse(10, 14, 260, 260, 0x000000, 0.3);
    const body = scene.add.image(0, 0, assetManifest.station).setDisplaySize(308, 308);
    if (station.destinationId === 'pallas-gate') {
      body.setTint(0xcad7d4).setAngle(45);
    }
    this.selectionRadius = station.collider.radius * 1.31;
    this.progressRadius = station.collider.radius * 1.38;
    this.selection = scene.add.graphics();
    this.dockingLights = scene.add.graphics();
    this.dockingLights.fillStyle(0x6de7dd, 0.75);
    for (let index = 0; index < 6; index += 1) {
      this.dockingLights.fillCircle(-20 + index * 8, -142, 1.25);
    }
    const label = scene.add.text(0, 158, `${station.code} // ${station.name.toUpperCase()}`, {
      fontFamily: 'monospace',
      fontSize: '8px',
      color: '#91a6ad',
      letterSpacing: 0.5,
    }).setOrigin(0.5, 0);
    this.container.add([shadow, body, this.dockingLights, this.selection, label]);
  }

  public update(selected: boolean, dockingProgress: number): void {
    this.selection.clear();
    if (selected) {
      this.selection.lineStyle(1.1, 0x6de7dd, 0.82);
      this.selection.strokeCircle(0, 0, this.selectionRadius);
      this.selection.lineStyle(1.6, 0xffb45f, 0.9);
      this.selection.beginPath();
      this.selection.arc(
        0,
        0,
        this.progressRadius,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * dockingProgress,
      );
      this.selection.strokePath();
    }
    this.dockingLights.setAlpha(0.55 + dockingProgress * 0.45);
  }

  public destroy(): void {
    this.container.destroy(true);
  }
}
