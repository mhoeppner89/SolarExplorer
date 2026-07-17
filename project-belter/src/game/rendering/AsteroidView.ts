import type Phaser from 'phaser';
import { assetManifest } from '../../assets/manifest';
import { resourceTierDefinitions } from '../../data/gameData';
import { getAsteroidLocalContour } from '../simulation/AsteroidShapeProfiles';
import type { AsteroidEntity } from '../simulation/components';
import type { InterpolatedTransform } from '../simulation/GameSimulation';

export class AsteroidView {
  public readonly container: Phaser.GameObjects.Container;
  private readonly collisionContour: Phaser.GameObjects.Graphics;
  private readonly body: Phaser.GameObjects.Image;
  private readonly resourceGlint: Phaser.GameObjects.Ellipse;
  private readonly miningScars: Phaser.GameObjects.Graphics;
  private readonly selection: Phaser.GameObjects.Graphics;

  public constructor(scene: Phaser.Scene, asteroid: AsteroidEntity) {
    this.container = scene.add.container(0, 0).setDepth(10);
    this.collisionContour = scene.add.graphics();
    this.drawCollisionContour(asteroid);
    const shapeIndex = {
      boulder: 0,
      shard: 1,
      rubble: 2,
      wedge: 3,
    }[asteroid.shapeClass];
    const textures = asteroid.sizeClass === 'very-large'
      ? assetManifest.colossalAsteroids[asteroid.materialClass]
      : assetManifest.asteroids[asteroid.materialClass];
    const texture = textures[shapeIndex] ?? textures[0];
    this.body = scene.add.image(0, 0, texture)
      .setDisplaySize(asteroid.radius * 2.35, asteroid.radius * 2.35);

    const glintPositions = [
      { x: 0.30, y: -0.20 },
      { x: 0.04, y: 0.02 },
      { x: 0.18, y: 0.12 },
      { x: 0.02, y: 0.14 },
    ];
    const glintPosition = glintPositions[shapeIndex] ?? glintPositions[0] ?? { x: 0, y: 0 };
    this.resourceGlint = scene.add.ellipse(
      asteroid.radius * glintPosition.x,
      asteroid.radius * glintPosition.y,
      Math.max(1.4, asteroid.radius * 0.11),
      Math.max(1.4, asteroid.radius * 0.11),
      asteroid.resourceType === 'none'
        ? 0x596166
        : asteroid.resourceType === 'water'
        ? 0x8fdde3
        : asteroid.resourceType === 'rare'
          ? 0xffb45f
          : 0xc5a86a,
      asteroid.resourceType === 'none' ? 0 : asteroid.resourceType === 'rare' ? 0.72 : 0.42,
    ).setScale(resourceTierDefinitions[asteroid.resourceTier].glintScale);

    this.miningScars = scene.add.graphics();
    const scarRadius = asteroid.radius * 0.34;
    this.miningScars.lineStyle(Math.max(0.6, asteroid.radius * 0.035), 0x11161a, 0.9);
    this.miningScars.beginPath();
    this.miningScars.moveTo(-scarRadius, -scarRadius * 0.24);
    this.miningScars.lineTo(-scarRadius * 0.22, scarRadius * 0.05);
    this.miningScars.lineTo(scarRadius * 0.08, scarRadius * 0.56);
    this.miningScars.lineTo(scarRadius * 0.58, scarRadius * 0.82);
    this.miningScars.strokePath();
    this.miningScars.fillStyle(0x080b0e, 0.76);
    this.miningScars.fillCircle(
      scarRadius * 0.08,
      scarRadius * 0.25,
      Math.max(1, asteroid.radius * 0.095),
    );
    this.miningScars.setAlpha(0);

    this.selection = scene.add.graphics();
    this.container.add([
      this.body,
      this.resourceGlint,
      this.miningScars,
      this.collisionContour,
      this.selection,
    ]);
  }

  public update(asteroid: AsteroidEntity, transform: InterpolatedTransform, selected: boolean): void {
    this.container.setPosition(transform.position.x, transform.position.y);
    this.container.setRotation(transform.heading);
    const yieldPercent = asteroid.maximumYield > 0
      ? Math.max(0, asteroid.remainingYield / asteroid.maximumYield)
      : 0;
    const barren = asteroid.resourceType === 'none';
    this.body.setAlpha(barren || asteroid.remainingYield > 0 ? 1 : 0.58);
    this.body.setTint(barren ? 0x8b8982 : yieldPercent <= 0 ? 0x6f7477 : 0xffffff);
    this.resourceGlint.setAlpha(barren ? 0 : Math.max(0, Math.min(0.78, yieldPercent * 0.82)));
    this.resourceGlint.setScale(
      resourceTierDefinitions[asteroid.resourceTier].glintScale * (0.72 + yieldPercent * 0.28),
    );
    this.miningScars.setAlpha(barren ? 0 : Math.min(0.9, Math.max(0, (1 - yieldPercent) * 1.15)));
    this.collisionContour.setAlpha(selected ? 1 : 0.88);

    this.selection.clear();
    if (selected) {
      this.selection.lineStyle(1.1, 0x71e7de, 0.92);
      this.strokeContour(this.selection, asteroid, 5.5);
      this.selection.lineStyle(0.65, 0xffb45f, 0.72);
      this.strokeContour(this.selection, asteroid, 8.5);
    }
  }

  public destroy(): void {
    this.container.destroy(true);
  }

  private drawCollisionContour(asteroid: AsteroidEntity): void {
    const styles: Record<AsteroidEntity['sizeClass'], { color: number; alpha: number; width: number }> = {
      'very-small': { color: 0x66777c, alpha: 0.25, width: 0.65 },
      small: { color: 0x78959a, alpha: 0.31, width: 0.75 },
      medium: { color: 0x71e7de, alpha: 0.39, width: 0.95 },
      large: { color: 0xffb45f, alpha: 0.49, width: 1.15 },
      'very-large': { color: 0xff8f4f, alpha: 0.58, width: 1.4 },
    };
    const style = styles[asteroid.sizeClass];
    this.collisionContour.lineStyle(style.width, style.color, style.alpha);
    this.strokeContour(this.collisionContour, asteroid, 0);

    const tickLength = asteroid.sizeClass === 'very-large'
      ? 7
      : asteroid.sizeClass === 'large'
        ? 4.5
        : asteroid.sizeClass === 'medium'
          ? 3
          : 1.8;
    this.collisionContour.lineStyle(style.width + 0.2, style.color, Math.min(0.72, style.alpha + 0.18));
    const contour = getAsteroidLocalContour(asteroid);
    const tickStep = Math.max(1, Math.floor(contour.length / 4));
    for (let index = 0; index < contour.length; index += tickStep) {
      const point = contour[index];
      if (point === undefined) {
        continue;
      }
      const magnitude = Math.hypot(point.x, point.y) || 1;
      const normalX = point.x / magnitude;
      const normalY = point.y / magnitude;
      this.collisionContour.beginPath();
      this.collisionContour.moveTo(point.x - normalX * tickLength, point.y - normalY * tickLength);
      this.collisionContour.lineTo(point.x + normalX * tickLength, point.y + normalY * tickLength);
      this.collisionContour.strokePath();
    }
  }

  private strokeContour(
    graphics: Phaser.GameObjects.Graphics,
    asteroid: AsteroidEntity,
    padding: number,
  ): void {
    const points = getAsteroidLocalContour(asteroid, padding);
    const first = points[0];
    if (first === undefined) {
      return;
    }
    graphics.beginPath();
    graphics.moveTo(first.x, first.y);
    for (let index = 1; index < points.length; index += 1) {
      const point = points[index];
      if (point !== undefined) {
        graphics.lineTo(point.x, point.y);
      }
    }
    graphics.closePath();
    graphics.strokePath();
  }
}
