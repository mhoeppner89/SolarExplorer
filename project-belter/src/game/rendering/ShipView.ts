import type Phaser from 'phaser';
import { assetManifest } from '../../assets/manifest';
import type { ModuleId } from '../../data/gameData';
import type { FlightActionState } from '../input/InputActions';
import type { HardpointId, ShipEntity } from '../simulation/components';
import type { InterpolatedTransform, SimulationDebugSnapshot } from '../simulation/GameSimulation';
import {
  getShipLocalCargoBayAnchor,
  getShipLocalContour,
  getShipLocalHardpointAnchor,
  SHIP_DISPLAY_HEIGHT,
  SHIP_DISPLAY_WIDTH,
} from '../simulation/ShipShapeProfile';
import { getSideThrusterVisualState } from './ThrusterVisuals';

const equipmentTexture = (moduleId: ModuleId): string => {
  switch (moduleId) {
    case 'mining-drone':
      return assetManifest.drones[0];
    case 'engine-kestrel':
      return assetManifest.ship.moduleEngine;
    case 'retro-brace':
      return assetManifest.ship.moduleRetro;
    case 'cargo-saddles':
      return assetManifest.ship.moduleCargo;
    case 'flight-assist':
      return assetManifest.ship.moduleAssist;
  }
};

export class ShipView {
  public readonly container: Phaser.GameObjects.Container;
  private readonly engineHalo: Phaser.GameObjects.Ellipse;
  private readonly engineCore: Phaser.GameObjects.Ellipse;
  private readonly mainDrivePlume: Phaser.GameObjects.Graphics;
  private readonly reverseFlames: Record<'port' | 'starboard', Phaser.GameObjects.Graphics>;
  private readonly auxiliaryForwardPlumes: Record<'port' | 'starboard', Phaser.GameObjects.Graphics>;
  private readonly sideThrusters: Record<
    'portFore' | 'portAft' | 'starboardFore' | 'starboardAft',
    Phaser.GameObjects.Graphics
  >;
  private readonly body: Phaser.GameObjects.Image;
  private readonly contour: Phaser.GameObjects.Graphics;
  private readonly cargoBayGlow: Phaser.GameObjects.Graphics;
  private readonly hardpointSprites: Record<HardpointId, Phaser.GameObjects.Image>;
  private readonly damageMarks: Record<HardpointId, Phaser.GameObjects.Graphics>;

  public constructor(scene: Phaser.Scene) {
    this.container = scene.add.container(0, 0).setDepth(40);
    const underGlow = scene.add.ellipse(0, 4, 34, 58, 0x65c8ca, 0.04);
    this.engineHalo = scene.add.ellipse(0, 35.2, 13, 10, 0xffa53d, 0.12);
    this.engineCore = scene.add.ellipse(0, 35.2, 6.4, 3.8, 0xffd46d, 0.12);
    this.mainDrivePlume = scene.add.graphics().setPosition(0, 32.2);
    this.reverseFlames = {
      port: scene.add.graphics().setPosition(-13.95, -23.7),
      starboard: scene.add.graphics().setPosition(13.95, -23.7),
    };
    this.auxiliaryForwardPlumes = {
      port: scene.add.graphics().setPosition(-14.55, 25.2),
      starboard: scene.add.graphics().setPosition(14.55, 25.2),
    };
    this.sideThrusters = {
      portFore: scene.add.graphics(),
      portAft: scene.add.graphics(),
      starboardFore: scene.add.graphics(),
      starboardAft: scene.add.graphics(),
    };
    this.drawThrusterShapes();

    this.body = scene.add.image(0, 0, assetManifest.ship.base)
      .setDisplaySize(SHIP_DISPLAY_WIDTH, SHIP_DISPLAY_HEIGHT);
    this.cargoBayGlow = scene.add.graphics();
    this.drawCargoBay(false);
    this.hardpointSprites = {
      port: this.createHardpointSprite(scene, 'port'),
      starboard: this.createHardpointSprite(scene, 'starboard'),
      ventral: this.createHardpointSprite(scene, 'ventral'),
    };
    this.damageMarks = {
      port: scene.add.graphics(),
      starboard: scene.add.graphics(),
      ventral: scene.add.graphics(),
    };
    for (const hardpoint of ['port', 'starboard', 'ventral'] as const) {
      this.drawDamageMark(hardpoint, 100);
    }
    this.contour = scene.add.graphics();
    this.drawCollisionContour();

    this.container.add([
      underGlow,
      this.body,
      this.reverseFlames.port,
      this.reverseFlames.starboard,
      this.auxiliaryForwardPlumes.port,
      this.auxiliaryForwardPlumes.starboard,
      this.engineHalo,
      this.engineCore,
      this.cargoBayGlow,
      this.hardpointSprites.port,
      this.hardpointSprites.starboard,
      this.hardpointSprites.ventral,
      this.damageMarks.port,
      this.damageMarks.starboard,
      this.damageMarks.ventral,
      this.sideThrusters.portFore,
      this.sideThrusters.portAft,
      this.sideThrusters.starboardFore,
      this.sideThrusters.starboardAft,
      this.contour,
      this.mainDrivePlume,
    ]);
  }

  public update(
    ship: ShipEntity,
    transform: InterpolatedTransform,
    actions: FlightActionState,
    snapshot: SimulationDebugSnapshot,
  ): void {
    this.container.setPosition(transform.position.x, transform.position.y);
    this.container.setRotation(transform.heading);
    const hullRatio = ship.maxHull > 0 ? ship.hull / ship.maxHull : 0;
    if (hullRatio < 0.32) {
      this.body.setTint(0xff8b7d);
    } else if (hullRatio < 0.68) {
      this.body.setTint(0xffd0a0);
    } else {
      this.body.clearTint();
    }

    for (const hardpoint of ['port', 'starboard', 'ventral'] as const) {
      const equipment = snapshot.ship.hardpoints[hardpoint];
      const sprite = this.hardpointSprites[hardpoint];
      if (equipment.moduleId === null || !equipment.occupied) {
        sprite.setVisible(false);
      } else {
        sprite
          .setTexture(equipmentTexture(equipment.moduleId))
          .setVisible(true)
          .setAlpha(equipment.condition <= 0 ? 0.46 : 1);
        if (equipment.condition <= 0) {
          sprite.setTint(0x7b3e36);
        } else if (equipment.condition < 45) {
          sprite.setTint(0xff9d72);
        } else {
          sprite.clearTint();
        }
      }
      this.drawDamageMark(hardpoint, equipment.condition);
    }
    this.drawCargoBay(snapshot.ship.cargoBayActive);

    const forward = Math.min(1, Math.max(0, actions.thrustForward));
    const reverse = Math.min(1, Math.max(0, actions.thrustReverse));
    const poweredForward = ship.fuel > 0 ? forward : 0;
    const sideThrusters = getSideThrusterVisualState(actions);

    this.engineHalo
      .setAlpha(0.08 + poweredForward * 0.58)
      .setScale(1 + poweredForward * 0.42);
    this.engineCore
      .setAlpha(0.1 + poweredForward * 0.8)
      .setScale(1 + poweredForward * 0.18);
    this.mainDrivePlume
      .setVisible(poweredForward > 0.01)
      .setAlpha(0.52 + poweredForward * 0.48)
      .setScale(1, 0.58 + poweredForward * 0.52);
    for (const plume of Object.values(this.auxiliaryForwardPlumes)) {
      plume
        .setVisible(forward > 0.01)
        .setAlpha(0.45 + forward * 0.55)
        .setScale(1, 0.55 + forward * 0.45);
    }
    for (const plume of Object.values(this.reverseFlames)) {
      plume
        .setVisible(reverse > 0.01)
        .setAlpha(0.45 + reverse * 0.55)
        .setScale(1, 0.45 + reverse * 0.65);
    }
    for (const [name, strength] of Object.entries(sideThrusters) as Array<
      [keyof typeof sideThrusters, number]
    >) {
      this.sideThrusters[name]
        .setVisible(strength > 0.04)
        .setAlpha(0.46 + strength * 0.54)
        .setScale(0.55 + strength * 0.45, 1);
    }
  }

  public destroy(): void {
    this.container.destroy(true);
  }

  private createHardpointSprite(
    scene: Phaser.Scene,
    hardpoint: HardpointId,
  ): Phaser.GameObjects.Image {
    const anchor = getShipLocalHardpointAnchor(hardpoint);
    return scene.add.image(anchor.x, anchor.y, assetManifest.drones[0])
      .setDisplaySize(9.2, 9.2)
      .setVisible(false);
  }

  private drawCollisionContour(): void {
    const points = getShipLocalContour();
    this.contour.clear();
    if (points.length === 0) {
      return;
    }
    this.contour.lineStyle(0.65, 0x73cbd0, 0.68);
    this.contour.beginPath();
    this.contour.moveTo(points[0]?.x ?? 0, points[0]?.y ?? 0);
    for (const point of points.slice(1)) {
      this.contour.lineTo(point.x, point.y);
    }
    this.contour.closePath();
    this.contour.strokePath();
  }

  private drawCargoBay(active: boolean): void {
    const anchor = getShipLocalCargoBayAnchor();
    this.cargoBayGlow.clear();
    this.cargoBayGlow.lineStyle(0.7, active ? 0x6de7dd : 0xd9a55d, active ? 0.95 : 0.32);
    this.cargoBayGlow.strokeRoundedRect(anchor.x - 4.2, anchor.y - 4, 8.4, 8, 1.1);
    if (active) {
      this.cargoBayGlow.fillStyle(0x6de7dd, 0.18);
      this.cargoBayGlow.fillRoundedRect(anchor.x - 3.6, anchor.y - 3.4, 7.2, 6.8, 0.8);
    }
  }

  private drawDamageMark(hardpoint: HardpointId, condition: number): void {
    const mark = this.damageMarks[hardpoint];
    const anchor = getShipLocalHardpointAnchor(hardpoint);
    mark.clear();
    if (condition >= 70) {
      return;
    }
    const alpha = condition <= 0 ? 0.95 : 0.38 + (70 - condition) / 120;
    mark.lineStyle(0.8, condition <= 0 ? 0xff665c : 0xffb45f, alpha);
    mark.lineBetween(anchor.x - 3.8, anchor.y - 3.8, anchor.x + 3.8, anchor.y + 3.8);
    mark.lineBetween(anchor.x + 3.8, anchor.y - 3.8, anchor.x - 3.8, anchor.y + 3.8);
  }

  private drawThrusterShapes(): void {
    this.mainDrivePlume.fillStyle(0xff9d24, 1);
    this.mainDrivePlume.fillRoundedRect(-5.4, 0, 10.8, 4.8, 1.5);
    this.mainDrivePlume.fillStyle(0xffad36, 1);
    this.mainDrivePlume.fillTriangle(-4.8, 2.8, 4.8, 2.8, 0, 12.8);
    this.mainDrivePlume.fillStyle(0xfff09a, 1);
    this.mainDrivePlume.fillEllipse(0, 2.2, 7.8, 3.2);
    this.mainDrivePlume.fillTriangle(-2, 2.4, 2, 2.4, 0, 9.3);
    this.mainDrivePlume.setVisible(false);

    for (const plume of Object.values(this.auxiliaryForwardPlumes)) {
      plume.fillStyle(0x55cfff, 0.82);
      plume.fillTriangle(-0.75, 0, 0.75, 0, 0, 5);
      plume.fillStyle(0xe1fbff, 0.9);
      plume.fillTriangle(-0.35, 0, 0.35, 0, 0, 3.1);
      plume.setVisible(false);
    }

    for (const plume of Object.values(this.reverseFlames)) {
      plume.fillStyle(0x7cf7ff, 0.78);
      plume.fillTriangle(-0.75, 0, 0.75, 0, 0, -5.3);
      plume.fillStyle(0xe1fbff, 0.9);
      plume.fillTriangle(-0.35, 0, 0.35, 0, 0, -3.5);
      plume.setVisible(false);
    }

    this.drawSidePlume(this.sideThrusters.portFore, 'port', -13.7);
    this.drawSidePlume(this.sideThrusters.portAft, 'port', 11.7);
    this.drawSidePlume(this.sideThrusters.starboardFore, 'starboard', -13.7);
    this.drawSidePlume(this.sideThrusters.starboardAft, 'starboard', 11.7);
  }

  private drawSidePlume(
    graphics: Phaser.GameObjects.Graphics,
    side: 'port' | 'starboard',
    y: number,
  ): void {
    const direction = side === 'port' ? -1 : 1;
    const hullX = direction * 16.55;
    graphics.setPosition(hullX, y);
    const tipX = direction * 3.7;
    const coreTipX = direction * 2.35;
    graphics.fillStyle(0x54cfff, 0.84);
    graphics.fillCircle(0, 0, 0.62);
    graphics.fillTriangle(0, -0.82, 0, 0.82, tipX, 0);
    graphics.fillStyle(0xdffcff, 0.92);
    graphics.fillTriangle(0, -0.32, 0, 0.32, coreTipX, 0);
    graphics.setVisible(false);
  }
}
