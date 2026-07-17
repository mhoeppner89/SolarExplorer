import Phaser from 'phaser';
import type { CareerState } from '../../progression/CareerState';
import type { PlayerSettingsStore } from '../../app/PlayerSettings';
import type { HudRoot, TargetMarkerData } from '../../ui/HudRoot';
import { neutralFlightActions, type FlightActionState } from '../input/InputActions';
import type { InputManager } from '../input/InputManager';
import { CameraRig, type CameraTelemetry } from '../rendering/CameraRig';
import { StarfieldView } from '../rendering/StarfieldView';
import { ViewRegistry } from '../rendering/ViewRegistry';
import type { CollisionOccurredEvent, SimulationEvent } from '../simulation/events';
import type { GameSimulation, SimulationDebugSnapshot } from '../simulation/GameSimulation';
import type { SimulationClock, SimulationClockStats } from '../simulation/SimulationClock';
import { rotate, subtract } from '../simulation/Vector2';

export interface FlightSceneServices {
  simulation: GameSimulation;
  clock: SimulationClock;
  input: InputManager;
  hud: HudRoot;
  settings: PlayerSettingsStore;
  getCareer: () => Readonly<CareerState>;
  isPaused: () => boolean;
  togglePause: () => void;
  onDocked: () => void;
  onShipDisabled: () => void;
  updateCameraTelemetry: (telemetry: CameraTelemetry) => void;
}

const idleClockStats = (): SimulationClockStats => ({
  steps: 0,
  interpolationAlpha: 0,
  droppedSeconds: 0,
});

const fallbackCameraTelemetry = (): CameraTelemetry => ({
  zoom: 1,
  anchorX: 0.5,
  anchorY: 0.74,
  lookAheadMetres: 0,
  rotation: 0,
});

export class FlightScene extends Phaser.Scene {
  private viewRegistry: ViewRegistry | null = null;
  private starfield: StarfieldView | null = null;
  private cameraRig: CameraRig | null = null;
  private currentActions: FlightActionState = neutralFlightActions();
  private clockStats: SimulationClockStats = idleClockStats();

  public constructor(private readonly services: FlightSceneServices) {
    super({ key: 'FlightScene' });
  }

  public create(): void {
    this.cameras.main.setBackgroundColor(0x05080c);
    this.starfield = new StarfieldView(this);
    this.viewRegistry = new ViewRegistry(this, this.services.simulation);
    this.cameraRig = new CameraRig(this.cameras.main);

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.handlePointerDown, this);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
  }

  public override update(_time: number, deltaMs: number): void {
    const delta = Math.min(250, Math.max(0, deltaMs));

    if (this.services.isPaused()) {
      this.currentActions = neutralFlightActions();
      this.clockStats = idleClockStats();
    } else {
      const frame = this.services.input.sample(delta);
      this.currentActions = frame.state;

      if (this.currentActions.pausePressed) {
        this.services.togglePause();
        this.currentActions = neutralFlightActions();
        this.clockStats = idleClockStats();
      } else {
        if (this.currentActions.recalibrateTiltPressed) {
          this.services.input.calibrateTilt();
        }
        this.clockStats = this.services.clock.advance(delta, (fixedDeltaSeconds) => {
          this.services.simulation.step(fixedDeltaSeconds, this.currentActions);
        });
      }
    }

    const interpolationAlpha = this.clockStats.interpolationAlpha;
    const snapshot = this.services.simulation.getDebugSnapshot();
    this.viewRegistry?.update(this, interpolationAlpha, snapshot);

    const shipTransform = this.services.simulation.getInterpolatedShip(interpolationAlpha);
    const cameraTelemetry = this.cameraRig?.update(
      this.services.simulation.ship,
      shipTransform,
      delta,
      this.services.settings.value,
      snapshot.mining.status === 'launching' || snapshot.mining.status === 'mining',
    );
    if (cameraTelemetry !== undefined) {
      this.services.updateCameraTelemetry(cameraTelemetry);
    }

    this.updateTargetMarker(snapshot, cameraTelemetry ?? fallbackCameraTelemetry());
    this.handleSimulationEvents(this.services.simulation.drainEvents());
    this.services.hud.updateFlight({
      snapshot,
      clock: this.clockStats,
      fps: this.game.loop.actualFps,
      actions: this.currentActions,
      camera: cameraTelemetry ?? fallbackCameraTelemetry(),
      career: this.services.getCareer(),
    });
  }

  private readonly handlePointerDown = (pointer: Phaser.Input.Pointer): void => {
    if (this.services.isPaused() || this.services.simulation.phase === 'station') {
      return;
    }
    const world = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    this.services.simulation.selectTargetAt({ x: world.x, y: world.y }, 24);
  };

  private updateTargetMarker(snapshot: SimulationDebugSnapshot, camera: CameraTelemetry): void {
    const target = snapshot.target;
    const beacon = snapshot.navigationBeacon;
    if (target === null && beacon === null) {
      this.services.hud.setTargetMarker(null);
      return;
    }

    const width = Math.max(1, this.scale.width);
    const height = Math.max(1, this.scale.height);
    const anchor = { x: width * camera.anchorX, y: height * camera.anchorY };
    const markerPosition = beacon?.position ?? target?.position;
    if (markerPosition === undefined) {
      this.services.hud.setTargetMarker(null);
      return;
    }
    const worldDelta = subtract(markerPosition, snapshot.ship.position);
    const cameraDelta = rotate(worldDelta, camera.rotation);
    const screen = {
      x: anchor.x + cameraDelta.x * camera.zoom,
      y: anchor.y + cameraDelta.y * camera.zoom,
    };
    const margin = 58;
    const onScreen = screen.x >= margin
      && screen.x <= width - margin
      && screen.y >= margin
      && screen.y <= height - margin;

    if (onScreen) {
      this.services.hud.setTargetMarker(null);
      return;
    }

    const centre = { x: width / 2, y: height / 2 };
    const ray = { x: screen.x - centre.x, y: screen.y - centre.y };
    const scaleX = Math.abs(ray.x) > 0.001 ? (width / 2 - margin) / Math.abs(ray.x) : Number.POSITIVE_INFINITY;
    const scaleY = Math.abs(ray.y) > 0.001 ? (height / 2 - margin) / Math.abs(ray.y) : Number.POSITIVE_INFINITY;
    const edgeScale = Math.max(0, Math.min(scaleX, scaleY));
    const marker: TargetMarkerData = {
      x: centre.x + ray.x * edgeScale,
      y: centre.y + ray.y * edgeScale,
      angle: Math.atan2(ray.y, ray.x) + Math.PI / 2,
      label: beacon !== null
        ? `NAV ${beacon.code} // ${beacon.distance >= 1000
            ? `${(beacon.distance / 1000).toFixed(1)} km`
            : `${Math.round(beacon.distance)} m`}`
        : (target?.distanceToSurface ?? 0) >= 1000
          ? `${((target?.distanceToSurface ?? 0) / 1000).toFixed(1)} km`
          : `${Math.round(target?.distanceToSurface ?? 0)} m`,
      kind: beacon !== null
        ? beacon.kind === 'station'
          ? 'station'
          : beacon.kind === 'trader'
            ? 'trader'
            : 'asteroid'
        : target?.kind ?? 'station',
    };
    this.services.hud.setTargetMarker(marker);
  }

  private handleSimulationEvents(events: readonly SimulationEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'CollisionOccurred':
          this.handleCollision(event);
          break;
        case 'ShipDisabled':
          this.services.onShipDisabled();
          break;
        case 'TargetSelected':
          this.services.hud.showToast(`TARGET LOCK // ${event.name}`);
          break;
        case 'TargetCleared':
          this.services.hud.showToast('TARGET CLEARED');
          break;
        case 'AssistChanged':
          this.services.hud.showToast(event.enabled ? 'APPROACH ASSIST ENGAGED' : 'APPROACH ASSIST DISENGAGED');
          break;
        case 'AutopilotChanged':
          this.services.hud.showToast(
            event.enabled
              ? 'AUTOPILOT ENGAGED // COLLISION-AVOIDANCE ROUTE ACTIVE'
              : event.arrived
                ? 'AUTOPILOT ARRIVAL // FLIGHT CONTROL RETURNED'
                : 'AUTOPILOT DISENGAGED',
            event.enabled || event.arrived ? 'info' : 'warning',
            3600,
          );
          break;
        case 'EquipmentDamaged':
          this.services.hud.showToast(
            `${event.hardpoint.toUpperCase()} EQUIPMENT ${event.disabled ? 'DISABLED' : 'DAMAGED'} // ${Math.round(event.condition)}%`,
            event.disabled ? 'danger' : 'warning',
            4200,
          );
          break;
        case 'DroneLaunched':
          this.services.hud.showToast('MINING DRONE LAUNCHED');
          break;
        case 'CargoDelivered':
          this.services.hud.showToast(`CARGO TRANSFER // +${event.amount.toFixed(1)} t`);
          break;
        case 'MiningStateChanged':
          if (event.status === 'recalling') {
            this.services.hud.showToast('DRONES RECALLING');
          } else if (event.status === 'depleted') {
            this.services.hud.showToast('TARGET DEPLETED');
          }
          break;
        case 'DockingStarted':
          this.services.hud.showToast('DOCKING CLAMPS ALIGNING');
          break;
        case 'DockingCompleted':
          this.services.onDocked();
          break;
        case 'LaunchCompleted':
          this.services.hud.showToast('UNDOCK COMPLETE // FLIGHT CONTROL ACTIVE');
          break;
        case 'AsteroidDepleted':
          break;
        case 'AsteroidFractured':
          if (event.cause === 'ship') {
            this.services.hud.showToast(
              `ASTEROID FRACTURE // ${event.fragmentIds.length} TRACKABLE FRAGMENTS`,
              'warning',
              3600,
            );
            this.cameras.main.shake(95, 0.0018 * this.services.settings.value.screenShake);
          }
          break;
      }
    }
  }

  private handleCollision(event: CollisionOccurredEvent): void {
    this.services.hud.reportImpact(event);
    const intensityBySeverity = {
      safe: 0.0008,
      minor: 0.0022,
      serious: 0.0048,
      severe: 0.008,
    } as const;
    const durationBySeverity = {
      safe: 45,
      minor: 80,
      serious: 130,
      severe: 190,
    } as const;
    const shakeSetting = this.services.settings.value.screenShake;
    if (shakeSetting > 0) {
      this.cameras.main.shake(
        durationBySeverity[event.severity],
        intensityBySeverity[event.severity] * shakeSetting,
      );
    }
  }

  private readonly handleResize = (): void => {
    this.cameras.main.setViewport(0, 0, this.scale.width, this.scale.height);
  };

  private shutdown(): void {
    this.input.off(Phaser.Input.Events.POINTER_DOWN, this.handlePointerDown, this);
    this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.viewRegistry?.destroy();
    this.viewRegistry = null;
    this.starfield?.destroy();
    this.starfield = null;
    this.cameraRig = null;
  }
}
