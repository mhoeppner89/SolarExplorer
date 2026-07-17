import type Phaser from 'phaser';
import { tuning } from '../config/tuning';
import type { SimulationDebugSnapshot } from '../simulation/GameSimulation';
import { clampMagnitude, scale, subtract } from '../simulation/Vector2';

export class NavigationView {
  private readonly graphics: Phaser.GameObjects.Graphics;

  public constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics().setDepth(32);
  }

  public update(snapshot: SimulationDebugSnapshot): void {
    this.graphics.clear();
    const ship = snapshot.ship;
    if (snapshot.navigationBeacon !== null && snapshot.autopilot.path.length > 0) {
      const routeColor = snapshot.autopilot.enabled
        ? snapshot.autopilot.status === 'avoidance' ? 0xffb45f : 0x73cbd0
        : 0x8aa6aa;
      this.graphics.lineStyle(
        snapshot.autopilot.enabled ? 1.2 : 0.85,
        routeColor,
        snapshot.autopilot.enabled ? 0.7 : 0.46,
      );
      this.graphics.beginPath();
      this.graphics.moveTo(ship.position.x, ship.position.y);
      for (const point of snapshot.autopilot.path) {
        this.graphics.lineTo(point.x, point.y);
      }
      this.graphics.strokePath();
      this.graphics.fillStyle(routeColor, 0.9);
      for (const point of snapshot.autopilot.path.slice(0, -1)) {
        this.graphics.fillCircle(point.x, point.y, 2.6);
      }
    }
    const beacon = snapshot.navigationBeacon;
    if (beacon !== null) {
      const beaconDelta = subtract(beacon.position, ship.position);
      const beaconLine = clampMagnitude(beaconDelta, 112);
      const beaconEnd = {
        x: ship.position.x + beaconLine.x,
        y: ship.position.y + beaconLine.y,
      };
      this.graphics.lineStyle(1.15, 0x73cbd0, 0.78);
      this.graphics.lineBetween(ship.position.x, ship.position.y, beaconEnd.x, beaconEnd.y);
      this.graphics.lineStyle(0.8, 0xd9a55d, 0.9);
      this.graphics.strokeCircle(beaconEnd.x, beaconEnd.y, 3.5);
    }

    const target = snapshot.target;
    if (target === null) {
      return;
    }
    const delta = subtract(target.position, ship.position);
    const line = clampMagnitude(delta, 90);
    this.graphics.lineStyle(0.65, 0x6de7dd, 0.25);
    this.graphics.lineBetween(ship.position.x, ship.position.y, ship.position.x + line.x, ship.position.y + line.y);

    if (target.kind === 'asteroid') {
      const miningRadius = target.radius + tuning.ship.radius + tuning.mining.distanceFromSurface;
      this.graphics.lineStyle(
        0.75,
        snapshot.mining.relativeSpeed !== null && snapshot.mining.relativeSpeed < tuning.mining.armRelativeSpeed
          ? 0x6de7dd
          : 0xffb45f,
        target.distanceToSurface < 80 ? 0.48 : 0.12,
      );
      this.graphics.strokeCircle(target.position.x, target.position.y, miningRadius);
    }

    const relativeVelocity = subtract(target.velocity, ship.velocity);
    const projected = clampMagnitude(scale(relativeVelocity, 4), 46);
    this.graphics.lineStyle(0.9, 0xffb45f, 0.72);
    this.graphics.lineBetween(
      target.position.x,
      target.position.y,
      target.position.x + projected.x,
      target.position.y + projected.y,
    );

    if (snapshot.assistEnabled) {
      const desiredDelta = subtract(snapshot.desiredVelocity, ship.velocity);
      const desired = clampMagnitude(scale(desiredDelta, 4), 44);
      this.graphics.lineStyle(0.85, 0xb8fff9, 0.58);
      this.graphics.lineBetween(
        ship.position.x,
        ship.position.y,
        ship.position.x + desired.x,
        ship.position.y + desired.y,
      );
    }
  }

  public destroy(): void {
    this.graphics.destroy();
  }
}
