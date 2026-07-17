import type Phaser from 'phaser';
import { assetManifest } from '../../assets/manifest';
import type { TraderEntity } from '../simulation/components';
import type { InterpolatedTransform } from '../simulation/GameSimulation';
import {
  getShipLocalContour,
  SHIP_DISPLAY_HEIGHT,
  SHIP_DISPLAY_WIDTH,
} from '../simulation/ShipShapeProfile';

export class TraderView {
  public readonly container: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Image;
  private readonly engine: Phaser.GameObjects.Graphics;
  private readonly collisionContour: Phaser.GameObjects.Graphics;
  private readonly selection: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;

  public constructor(scene: Phaser.Scene) {
    this.container = scene.add.container(0, 0).setDepth(36);
    this.body = scene.add.image(0, 0, assetManifest.ship.base)
      .setDisplaySize(SHIP_DISPLAY_WIDTH * 0.92, SHIP_DISPLAY_HEIGHT * 0.92)
      .setTint(0xd4e4df);
    this.engine = scene.add.graphics();
    this.engine.fillStyle(0x73e8ff, 0.9);
    this.engine.fillTriangle(-2.1, 30, 2.1, 30, 0, 41);
    this.engine.fillStyle(0xffffff, 0.8);
    this.engine.fillTriangle(-0.8, 30, 0.8, 30, 0, 36);
    this.collisionContour = scene.add.graphics();
    this.strokeContour(this.collisionContour, 0x75bdc1, 0.52, 0);
    this.selection = scene.add.graphics();
    this.label = scene.add.text(0, -42, 'FREE TRADER // LARK 07', {
      fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
      fontSize: '6px',
      color: '#aee9e6',
      backgroundColor: '#071013cc',
      padding: { x: 3, y: 2 },
      align: 'center',
    }).setOrigin(0.5);
    this.container.add([this.body, this.engine, this.collisionContour, this.selection, this.label]);
  }

  public update(trader: TraderEntity, transform: InterpolatedTransform, selected: boolean): void {
    this.container.setPosition(transform.position.x, transform.position.y);
    this.container.setRotation(transform.heading);
    const speed = Math.hypot(trader.velocity.linear.x, trader.velocity.linear.y);
    this.engine
      .setVisible(trader.state === 'traveling' && speed > 0.4)
      .setAlpha(Math.min(1, 0.35 + speed / 45));
    this.label.setText(trader.state === 'docked'
      ? 'FREE TRADER // DOCKED'
      : 'FREE TRADER // LARK 07');
    this.label.setRotation(-transform.heading);
    this.selection.clear();
    if (selected) {
      this.strokeContour(this.selection, 0x71e7de, 0.95, 4.5);
      this.strokeContour(this.selection, 0xffb45f, 0.72, 7.5);
    }
  }

  public destroy(): void {
    this.container.destroy(true);
  }

  private strokeContour(
    graphics: Phaser.GameObjects.Graphics,
    color: number,
    alpha: number,
    padding: number,
  ): void {
    const points = getShipLocalContour().map((point) => {
      const magnitude = Math.hypot(point.x, point.y) || 1;
      return {
        x: point.x * 0.92 + point.x / magnitude * padding,
        y: point.y * 0.92 + point.y / magnitude * padding,
      };
    });
    const first = points[0];
    if (first === undefined) {
      return;
    }
    graphics.lineStyle(padding > 0 ? 0.85 : 0.7, color, alpha);
    graphics.beginPath();
    graphics.moveTo(first.x, first.y);
    for (const point of points.slice(1)) {
      graphics.lineTo(point.x, point.y);
    }
    graphics.closePath();
    graphics.strokePath();
  }
}
