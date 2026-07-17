import type Phaser from 'phaser';
import { tuning } from '../config/tuning';
import type { ShipEntity } from '../simulation/components';
import type { InterpolatedTransform } from '../simulation/GameSimulation';
import { length, normalize, scale } from '../simulation/Vector2';

export interface VelocityVectorPresentation {
  length: number;
  lineWidth: number;
  color: number;
  warning: string | null;
}

export const getVelocityVectorPresentation = (speed: number): VelocityVectorPresentation => {
  const normalizedSpeed = Math.max(0, speed);
  const overspeed = Math.min(
    1,
    Math.max(
      0,
      (normalizedSpeed - tuning.velocityVectorLengthSpeed)
        / (tuning.ship.internalSafetySpeedClamp - tuning.velocityVectorLengthSpeed),
    ),
  );
  const warning = normalizedSpeed >= tuning.ship.internalSafetySpeedClamp - 5
    ? `MAX SPEED LIMIT // ${tuning.ship.internalSafetySpeedClamp} M/S`
    : normalizedSpeed >= tuning.velocityVectorWarningSpeed
      ? `HIGH VELOCITY // ${Math.round(normalizedSpeed)} M/S`
      : null;
  return {
    length: tuning.velocityVectorMaxLength * Math.min(
      1,
      normalizedSpeed / tuning.velocityVectorLengthSpeed,
    ),
    lineWidth: 0.9 + overspeed * 2.8,
    color: normalizedSpeed >= tuning.velocityVectorRedSpeed
      ? 0xff625b
      : normalizedSpeed > tuning.velocityVectorLengthSpeed
        ? 0xffc45f
        : 0x6de7dd,
    warning,
  };
};

export class VelocityVectorView {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly warning: Phaser.GameObjects.Text;

  public constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics().setDepth(34);
    this.warning = scene.add.text(0, 0, '', {
      color: '#ffc45f',
      fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
      fontSize: '6px',
      fontStyle: 'bold',
      stroke: '#05080c',
      strokeThickness: 2,
    }).setOrigin(0.5, 1).setDepth(35).setVisible(false);
  }

  public update(ship: ShipEntity, transform: InterpolatedTransform): void {
    this.graphics.clear();
    this.warning.setVisible(false);
    const speed = length(ship.velocity.linear);
    const presentation = getVelocityVectorPresentation(speed);
    if (presentation.length < 0.35) {
      return;
    }
    const projected = scale(normalize(ship.velocity.linear), presentation.length);
    const magnitude = presentation.length;

    const startX = transform.position.x;
    const startY = transform.position.y;
    const endX = startX + projected.x;
    const endY = startY + projected.y;
    const directionX = projected.x / magnitude;
    const directionY = projected.y / magnitude;
    const normalX = -directionY;
    const normalY = directionX;
    const headLength = Math.min(4.5, Math.max(2, magnitude * 0.12));

    this.graphics.lineStyle(presentation.lineWidth, presentation.color, 0.82);
    this.graphics.lineBetween(startX, startY, endX, endY);
    this.graphics.lineStyle(
      Math.max(1.1, presentation.lineWidth * 0.92),
      presentation.color,
      0.96,
    );
    this.graphics.lineBetween(
      endX,
      endY,
      endX - directionX * headLength + normalX * headLength * 0.55,
      endY - directionY * headLength + normalY * headLength * 0.55,
    );
    this.graphics.lineBetween(
      endX,
      endY,
      endX - directionX * headLength - normalX * headLength * 0.55,
      endY - directionY * headLength - normalY * headLength * 0.55,
    );
    this.graphics.fillStyle(presentation.color, 0.88);
    this.graphics.fillCircle(endX, endY, Math.max(0.9, presentation.lineWidth * 0.55));

    if (presentation.warning !== null) {
      this.warning
        .setText(presentation.warning)
        .setColor(speed >= tuning.velocityVectorRedSpeed ? '#ff746d' : '#ffc45f')
        .setPosition(endX + normalX * 5, endY + normalY * 5)
        .setRotation(transform.heading)
        .setVisible(true);
    }
  }

  public destroy(): void {
    this.graphics.destroy();
    this.warning.destroy();
  }
}
