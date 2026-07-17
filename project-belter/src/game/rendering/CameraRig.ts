import type Phaser from 'phaser';
import type { PlayerSettings } from '../../app/PlayerSettings';
import { tuning } from '../config/tuning';
import type { InterpolatedTransform } from '../simulation/GameSimulation';
import { length } from '../simulation/Vector2';
import type { ShipEntity } from '../simulation/components';

export interface CameraTelemetry {
  zoom: number;
  anchorX: number;
  anchorY: number;
  lookAheadMetres: number;
  rotation: number;
}

export const getCameraTargetZoom = (
  baseZoom: number,
  speed: number,
  settings: Readonly<PlayerSettings>,
  miningActive = false,
): number => {
  const speedFactor = Math.min(
    1,
    Math.max(0, speed) / tuning.ship.internalSafetySpeedClamp,
  );
  const stationaryZoom = baseZoom * settings.stationaryZoomMultiplier;
  const maximumSpeedZoom = baseZoom * settings.maximumSpeedZoomMultiplier;
  const speedZoom = stationaryZoom + (maximumSpeedZoom - stationaryZoom) * speedFactor;
  return settings.dynamicZoom
    ? speedZoom * (miningActive ? tuning.cameraMiningZoomMultiplier : 1)
    : stationaryZoom;
};

export class CameraRig {
  private zoom = tuning.cameraZoomPortrait;
  private telemetryValue: CameraTelemetry = {
    zoom: this.zoom,
    anchorX: 0.5,
    anchorY: tuning.portraitShipAnchorY,
    lookAheadMetres: tuning.cameraLookAheadMin,
    rotation: 0,
  };

  public constructor(private readonly camera: Phaser.Cameras.Scene2D.Camera) {
    camera.roundPixels = false;
    camera.setBackgroundColor(0x05080c);
  }

  public update(
    ship: ShipEntity,
    transform: InterpolatedTransform,
    deltaMs: number,
    settings: Readonly<PlayerSettings>,
    miningActive = false,
  ): CameraTelemetry {
    const width = Math.max(1, this.camera.width);
    const height = Math.max(1, this.camera.height);
    const portrait = height >= width;
    const desktopLandscape = width >= 900 && !portrait;
    const baseZoom = portrait
      ? tuning.cameraZoomPortrait
      : desktopLandscape
        ? tuning.cameraZoomDesktop
        : tuning.cameraZoomLandscape;
    const baseAnchorY = portrait ? tuning.portraitShipAnchorY : tuning.landscapeShipAnchorY;
    const targetZoom = getCameraTargetZoom(
      baseZoom,
      length(ship.velocity.linear),
      settings,
      miningActive,
    );
    const response = 1 - Math.exp(-(Math.max(0, deltaMs) / 1000) * tuning.cameraZoomResponse);
    this.zoom += (targetZoom - this.zoom) * response;

    const rawLookAhead = ((baseAnchorY - 0.5) * height) / this.zoom;
    const lookAhead = Math.min(
      tuning.cameraLookAheadMax,
      Math.max(tuning.cameraLookAheadMin, rawLookAhead),
    );
    const anchorY = 0.5 + (lookAhead * this.zoom) / height;

    this.camera.setZoom(this.zoom);
    this.camera.setOrigin(0.5, anchorY);
    this.camera.setRotation(-transform.heading);
    // Phaser scroll values are world-pixel offsets and are not divided by zoom.
    // Placing the ship at the camera rotation origin keeps it fixed while the world rotates.
    this.camera.setScroll(
      transform.position.x - width * 0.5,
      transform.position.y - height * anchorY,
    );

    this.telemetryValue = {
      zoom: this.zoom,
      anchorX: 0.5,
      anchorY,
      lookAheadMetres: lookAhead,
      rotation: -transform.heading,
    };
    return this.telemetryValue;
  }

  public get telemetry(): CameraTelemetry {
    return this.telemetryValue;
  }
}
