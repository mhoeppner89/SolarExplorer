import Phaser from 'phaser';
import type { BelterDebugBridge } from './DebugBridge';
import { PlayerSettingsStore } from './PlayerSettings';
import { moduleDefinitions } from '../data/gameData';
import { getNavigationDestination, navigationDestinations } from '../data/navigationData';
import { tuning } from '../game/config/tuning';
import { neutralFlightActions, type InputMode } from '../game/input/InputActions';
import { InputManager } from '../game/input/InputManager';
import type { CameraTelemetry } from '../game/rendering/CameraRig';
import { BootScene } from '../game/scenes/BootScene';
import { FlightScene } from '../game/scenes/FlightScene';
import { GameSimulation } from '../game/simulation/GameSimulation';
import { SimulationClock } from '../game/simulation/SimulationClock';
import {
  createDefaultCareer,
  mountModule,
  normalizeCareer,
  purchaseAndInstallModule,
  repairHardpointEquipment,
  sellCargoIntoCareer,
  unmountHardpoint,
  type CareerState,
} from '../progression/CareerState';
import { SaveService } from '../save/SaveService';
import { HudRoot } from '../ui/HudRoot';
import type { HardpointId } from '../game/simulation/components';

export class GameApp {
  private readonly settings = new PlayerSettingsStore();
  private readonly saveService = new SaveService();
  private career: CareerState;
  private readonly hud: HudRoot;
  private readonly simulation: GameSimulation;
  private readonly clock = new SimulationClock(
    tuning.simulationHz,
    tuning.maxFrameDeltaMs,
    tuning.maxSimulationStepsPerFrame,
  );
  private readonly input: InputManager;
  private readonly game: Phaser.Game;
  private paused = false;
  private stationOpen = true;
  private navigationOpen = false;
  private cameraTelemetry: CameraTelemetry = {
    zoom: tuning.cameraZoomPortrait,
    anchorX: 0.5,
    anchorY: tuning.portraitShipAnchorY,
    lookAheadMetres: tuning.cameraLookAheadMin,
    rotation: 0,
  };

  public constructor(private readonly root: HTMLElement) {
    this.career = this.saveService.load();
    this.simulation = new GameSimulation(tuning, 0xb37e_2026, this.career.installedModules);
    this.applyCareerLoadout();
    this.hud = new HudRoot(root, this.settings);
    this.input = new InputManager(this.settings, this.hud.joystickElements, {
      onModeChanged: (mode) => {
        this.hud.setMode(mode);
      },
      onTiltStatusChanged: (status) => {
        this.hud.setTiltStatus(status);
      },
      onTiltFallback: (reason) => {
        const message = reason === 'unavailable'
          ? 'MOTION SENSORS UNAVAILABLE // JOYSTICK ACTIVE'
          : reason === 'denied'
            ? 'MOTION PERMISSION DENIED // JOYSTICK ACTIVE'
            : 'NO TILT DATA // HOLD PHONE STEADY AND CALIBRATE';
        this.hud.showToast(message, 'warning', 3600);
      },
    });

    if (this.settings.value.controlMode === 'tilt') {
      this.input.setMode('joystick');
    }

    this.hud.bindHandlers({
      onPauseToggle: () => {
        if (!this.stationOpen) {
          this.setPaused(!this.paused);
        }
      },
      onModeRequested: (mode) => {
        this.handleModeRequest(mode);
      },
      onTiltCalibrate: () => {
        const calibrated = this.input.calibrateTilt();
        this.hud.showToast(
          calibrated ? 'TILT NEUTRAL CALIBRATED' : 'NO MOTION DATA // MOVE PHONE AND TRY AGAIN',
          calibrated ? 'info' : 'warning',
        );
      },
      onResetSimulation: () => {
        this.resetExpedition();
      },
      onResetCareer: () => {
        this.resetCareer();
      },
      onLaunch: () => {
        this.launchFromStation();
      },
      onContextAction: () => {
        const result = this.simulation.contextAction();
        if (result !== 'NO ACTION') {
          this.hud.showToast(result);
        }
      },
      onNavigationToggle: () => {
        this.setNavigationOpen(!this.navigationOpen);
      },
      onNavigationDestinationSelected: (destinationId) => {
        const destination = getNavigationDestination(destinationId);
        if (destination === null || !this.simulation.setNavigationBeacon(destination)) {
          this.hud.showToast('NAVIGATION DESTINATION UNAVAILABLE', 'warning');
          return;
        }
        this.setNavigationOpen(false);
        this.hud.showToast(
          `ROUTE PLOTTED // ${destination.code} // MANUAL FLIGHT`,
          'info',
          3800,
        );
      },
      onNavigationEntitySelected: (kind, entityId) => {
        if (!this.simulation.setEntityNavigationBeacon(kind, entityId)) {
          this.hud.showToast('NAVIGATION CONTACT UNAVAILABLE', 'warning');
          return;
        }
        this.setNavigationOpen(false);
        const beacon = this.simulation.getDebugSnapshot().navigationBeacon;
        this.hud.showToast(
          `ROUTE PLOTTED // ${beacon?.code ?? 'TRACKED CONTACT'} // MANUAL FLIGHT`,
          'info',
          3800,
        );
      },
      onAutopilotToggle: () => {
        const snapshot = this.simulation.getDebugSnapshot();
        if (!snapshot.autopilotAvailable) {
          this.hud.showToast('WAYFINDER AUTOPILOT UPGRADE REQUIRED', 'warning');
          return;
        }
        if (snapshot.navigationBeacon === null) {
          this.hud.showToast('SELECT A NAVIGATION DESTINATION FIRST', 'warning');
          return;
        }
        const enabled = this.simulation.toggleAutopilot();
        this.setNavigationOpen(false);
        this.hud.showToast(
          enabled ? 'AUTOPILOT ENGAGED // ROUTE FOLLOWING' : 'AUTOPILOT DISENGAGED',
          enabled ? 'info' : 'warning',
        );
      },
      onStrafeHold: (direction) => {
        this.input.setExternalAction('strafe', direction);
      },
      onSellAll: () => {
        this.sellAllCargo();
      },
      onPurchaseModule: (moduleId) => {
        this.purchaseModule(moduleId);
      },
      onMountModule: (moduleId, hardpoint) => {
        this.mountModuleAtHardpoint(moduleId, hardpoint);
      },
      onUnmountHardpoint: (hardpoint) => {
        this.unmountHardpointAtStation(hardpoint);
      },
      onServiceShip: () => {
        this.serviceShip();
      },
    });

    const flightScene = new FlightScene({
      simulation: this.simulation,
      clock: this.clock,
      input: this.input,
      hud: this.hud,
      settings: this.settings,
      getCareer: () => this.career,
      isPaused: () => this.paused || this.stationOpen || this.navigationOpen,
      togglePause: () => {
        this.setPaused(!this.paused);
      },
      onDocked: () => {
        this.handleDocked();
      },
      onShipDisabled: () => {
        this.handleEmergencyTow();
      },
      updateCameraTelemetry: (telemetry) => {
        this.cameraTelemetry = telemetry;
      },
    });

    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: this.hud.canvasParent,
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: '#05080c',
      transparent: false,
      antialias: true,
      render: {
        antialias: true,
        roundPixels: false,
        powerPreference: 'high-performance',
      },
      fps: {
        target: 60,
        smoothStep: true,
      },
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: '100%',
        height: '100%',
      },
      input: {
        activePointers: 3,
        touch: { capture: true },
      },
      scene: [new BootScene(), flightScene],
    });

    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('orientationchange', this.handleOrientationChange);
    window.addEventListener('beforeunload', this.handleBeforeUnload);
    this.installDebugBridge();
    this.hud.setPaused(false);
    this.setStationOpen(true);
    this.refreshStationInterface();
  }

  public destroy(): void {
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('orientationchange', this.handleOrientationChange);
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
    this.saveCareer();
    this.input.destroy();
    this.hud.destroy();
    this.game.destroy(true);
    delete window.__BELTER_DEBUG__;
    delete window.render_game_to_text;
    delete window.advanceTime;
    this.root.replaceChildren();
  }

  private handleModeRequest(mode: InputMode): void {
    if (mode !== 'tilt') {
      this.input.setMode(mode);
      return;
    }

    void this.input.enableTilt().then((enabled) => {
      if (enabled) {
        this.hud.showToast('MOTION ACCESS ENABLED // HOLD COMFORTABLY, THEN CALIBRATE', 'info', 3600);
      }
    });
  }

  private setPaused(paused: boolean, reason?: string): void {
    this.paused = paused;
    this.updateInputSuspension();
    this.hud.setPaused(paused && !this.stationOpen);
    if (reason !== undefined) {
      this.hud.showToast(reason, 'danger', 4200);
    }
  }

  private setStationOpen(open: boolean): void {
    this.stationOpen = open;
    if (open) {
      this.paused = false;
      this.navigationOpen = false;
      this.hud.setNavigationOpen(false);
    }
    this.updateInputSuspension();
    this.hud.setPaused(false);
    this.hud.setStationOpen(open);
  }

  private updateInputSuspension(): void {
    this.input.setSuspended(this.paused || this.stationOpen || this.navigationOpen);
  }

  private setNavigationOpen(open: boolean): void {
    if (this.stationOpen || this.simulation.phase === 'disabled') {
      return;
    }
    this.navigationOpen = open;
    this.updateInputSuspension();
    this.hud.setNavigationOpen(open, open ? this.simulation.getDebugSnapshot() : undefined);
  }

  private launchFromStation(): boolean {
    if (!this.stationOpen) {
      return false;
    }
    const launched = this.simulation.launch();
    if (!launched) {
      return false;
    }
    this.clock.reset();
    this.setStationOpen(false);
    this.hud.showToast('LAUNCH CLEARANCE CONFIRMED // M-12 MARKED AHEAD');
    return true;
  }

  private handleDocked(): void {
    this.career.stats.expeditionsCompleted += 1;
    this.saveCareer();
    this.setStationOpen(true);
    this.refreshStationInterface();
    this.hud.showToast('DOCKING COMPLETE // CARGO SECURED', 'info', 3400);
  }

  private sellAllCargo(): number {
    const result = sellCargoIntoCareer(this.career, this.simulation.ship.cargo);
    this.simulation.clearCargo();
    if (result.revenue <= 0) {
      this.hud.showToast('CARGO HOLD EMPTY', 'warning');
      return 0;
    }
    this.saveCareer();
    this.refreshStationInterface();
    this.hud.showToast(
      `MARKET SALE // ${result.massSold.toFixed(1)} t // +${Math.round(result.revenue)} CR`,
      'info',
      3600,
    );
    return result.revenue;
  }

  private purchaseModule(moduleId: string): boolean {
    const result = purchaseAndInstallModule(this.career, moduleId);
    if (!result.ok) {
      const message = result.reason === 'insufficient-credits'
        ? 'INSUFFICIENT CREDITS'
        : result.reason === 'already-owned'
          ? 'INTERNAL UPGRADE ALREADY INSTALLED'
          : 'UNKNOWN MODULE';
      this.hud.showToast(message, 'warning');
      return false;
    }

    this.applyCareerLoadout();
    if (this.career.stats.expeditionsCompleted > 0 && this.career.stats.resourcesSold > 0) {
      this.career.tutorialComplete = true;
    }
    this.saveCareer();
    this.refreshStationInterface();
    const module = moduleDefinitions[result.definitionId];
    this.hud.showToast(`${module.displayName.toUpperCase()} // INSTALLED`, 'info', 3800);
    return true;
  }

  private serviceShip(): void {
    repairHardpointEquipment(this.career);
    this.simulation.repairAndRefuel();
    this.refreshStationInterface();
    this.saveCareer();
    this.hud.showToast('HULL, FUEL, AND DRONES SERVICED');
  }

  private resetExpedition(): void {
    this.simulation.initialize(undefined, this.career.installedModules);
    this.applyCareerLoadout();
    this.clock.reset();
    this.setStationOpen(true);
    this.refreshStationInterface();
    this.hud.showToast('EXPEDITION RESET // CAREER RETAINED');
  }

  private resetCareer(): void {
    this.saveService.clear();
    this.career = createDefaultCareer();
    this.simulation.initialize(undefined, this.career.installedModules);
    this.applyCareerLoadout();
    this.clock.reset();
    this.setStationOpen(true);
    this.refreshStationInterface();
    this.hud.showToast('LOCAL CAREER RESET', 'warning');
  }

  private handleEmergencyTow(): void {
    const towFee = Math.min(50, this.career.credits);
    this.career.credits -= towFee;
    this.simulation.initialize(undefined, this.career.installedModules);
    this.applyCareerLoadout();
    this.clock.reset();
    this.saveCareer();
    this.setStationOpen(true);
    this.refreshStationInterface();
    this.hud.showToast(`EMERGENCY TOW // ${Math.round(towFee)} CR // CARGO LOST`, 'danger', 5200);
  }

  private refreshStationInterface(): void {
    this.hud.updateStation(this.career, this.simulation.getDebugSnapshot());
  }

  private saveCareer(): void {
    this.syncCareerEquipmentFromSimulation();
    this.saveService.save(this.career);
  }

  private mountModuleAtHardpoint(moduleId: string, hardpoint: HardpointId): boolean {
    if (!(moduleId in moduleDefinitions) || !mountModule(this.career, moduleId as keyof typeof moduleDefinitions, hardpoint)) {
      this.hud.showToast('EQUIPMENT NOT AVAILABLE', 'warning');
      return false;
    }
    this.applyCareerLoadout();
    this.saveCareer();
    this.refreshStationInterface();
    this.hud.showToast(`${moduleDefinitions[moduleId as keyof typeof moduleDefinitions].displayName.toUpperCase()} // ${hardpoint.toUpperCase()} MOUNT`, 'info', 3200);
    return true;
  }

  private unmountHardpointAtStation(hardpoint: HardpointId): void {
    unmountHardpoint(this.career, hardpoint);
    this.applyCareerLoadout();
    this.saveCareer();
    this.refreshStationInterface();
    this.hud.showToast(`${hardpoint.toUpperCase()} HARDPOINT // CLEARED`, 'info', 2600);
  }

  private applyCareerLoadout(): void {
    this.simulation.applyHardpointLoadout(
      this.career.hardpointLoadout,
      this.career.hardpointCondition,
      this.career.installedModules,
    );
  }

  private syncCareerEquipmentFromSimulation(): void {
    const hardpoints = this.simulation.getDebugSnapshot().ship.hardpoints;
    for (const hardpoint of ['port', 'starboard', 'ventral'] as const) {
      this.career.hardpointCondition[hardpoint] = hardpoints[hardpoint].condition;
    }
  }

  private installDebugBridge(): void {
    const bridge: BelterDebugBridge = {
      getSnapshot: () => this.simulation.getDebugSnapshot(),
      getCareer: () => normalizeCareer(JSON.parse(JSON.stringify(this.career)) as Partial<CareerState>),
      getCameraTelemetry: () => ({ ...this.cameraTelemetry }),
      getInputMode: () => this.input.mode,
      isPaused: () => this.paused,
      isStationOpen: () => this.stationOpen,
      isNavigationOpen: () => this.navigationOpen,
      openNavigation: () => this.setNavigationOpen(true),
      selectNavigationDestination: (destinationId) => {
        const destination = getNavigationDestination(destinationId);
        if (destination === null) {
          return false;
        }
        const selected = this.simulation.setNavigationBeacon(destination);
        if (selected) {
          this.setNavigationOpen(false);
        }
        return selected;
      },
      selectNavigationEntity: (kind, entityId) =>
        this.simulation.setEntityNavigationBeacon(kind, entityId),
      toggleAutopilot: () => this.simulation.toggleAutopilot(),
      setShipPosition: (position) => {
        this.simulation.ship.transform.position = { ...position };
        this.simulation.ship.transform.previousPosition = { ...position };
      },
      setShipVelocity: (velocity) => {
        this.simulation.ship.velocity.linear = { ...velocity };
      },
      setShipFuel: (fuel) => {
        this.simulation.ship.fuel = Math.min(
          this.simulation.ship.fuelCapacity,
          Math.max(0, fuel),
        );
      },
      setFlightAction: (action, value) => {
        this.input.setExternalAction(action, value);
      },
      setCargoMass: (mass) => {
        this.simulation.setCargoMass(mass);
      },
      resetSimulation: () => {
        this.resetExpedition();
      },
      launch: () => this.launchFromStation(),
      getTutorialTarget: () => {
        const id = this.simulation.tutorialAsteroidId;
        const asteroid = id === null ? undefined : this.simulation.entities.asteroids.get(id);
        return asteroid === undefined
          ? null
          : { id: asteroid.id, position: { ...asteroid.transform.position } };
      },
      selectTutorialTarget: () => {
        const id = this.simulation.tutorialAsteroidId;
        return id !== null && this.simulation.selectAsteroid(id);
      },
      teleportNearTarget: (surfaceDistance) => {
        this.simulation.debugTeleportNearTarget(surfaceDistance);
      },
      recallDrones: () => {
        this.simulation.recallDrones();
      },
      prepareDocking: () => {
        this.simulation.debugPrepareDocking();
      },
      advanceSimulation: (seconds, actions = {}) => {
        const steps = Math.max(0, Math.ceil(seconds * tuning.simulationHz));
        const frameActions = { ...neutralFlightActions(), ...actions };
        for (let index = 0; index < steps; index += 1) {
          this.simulation.step(1 / tuning.simulationHz, frameActions);
        }
      },
      sellAllCargo: () => this.sellAllCargo(),
      buyModule: (moduleId) => this.purchaseModule(moduleId),
      destroy: () => {
        this.destroy();
      },
    };
    window.__BELTER_DEBUG__ = bridge;
    window.render_game_to_text = () => {
      const snapshot = this.simulation.getDebugSnapshot();
      const nearbyAsteroids = [...this.simulation.entities.asteroids.values()]
        .map((asteroid) => ({
          id: asteroid.id,
          name: asteroid.name,
          x: Number(asteroid.transform.position.x.toFixed(1)),
          y: Number(asteroid.transform.position.y.toFixed(1)),
          radius: Number(asteroid.radius.toFixed(1)),
          size: asteroid.sizeClass,
          material: asteroid.materialClass,
          shape: asteroid.shapeClass,
          resource: asteroid.resourceType,
          tier: asteroid.resourceTier,
          yield: Number(asteroid.remainingYield.toFixed(1)),
          generation: asteroid.fragmentGeneration,
          selected: snapshot.target?.kind === 'asteroid' && snapshot.target.id === asteroid.id,
        }))
        .sort((first, second) => {
          const firstDistance = Math.hypot(first.x - snapshot.ship.position.x, first.y - snapshot.ship.position.y);
          const secondDistance = Math.hypot(second.x - snapshot.ship.position.x, second.y - snapshot.ship.position.y);
          return firstDistance - secondDistance;
        })
        .slice(0, 12);
      return JSON.stringify({
        mode: this.stationOpen ? 'station' : this.navigationOpen ? 'navigation' : this.paused ? 'paused' : snapshot.phase,
        coordinateSystem: 'world metres; origin at station centre; +x right; +y down; heading 0 points up',
        ship: {
          x: Number(snapshot.ship.position.x.toFixed(2)),
          y: Number(snapshot.ship.position.y.toFixed(2)),
          vx: Number(snapshot.ship.velocity.x.toFixed(2)),
          vy: Number(snapshot.ship.velocity.y.toFixed(2)),
          speed: Number(snapshot.ship.speed.toFixed(2)),
          speedLimit: tuning.ship.internalSafetySpeedClamp,
          heading: Number(snapshot.ship.heading.toFixed(3)),
          hull: Number(snapshot.ship.hull.toFixed(1)),
          fuel: Number(snapshot.ship.fuel.toFixed(1)),
          cargo: Number(snapshot.ship.cargoMass.toFixed(1)),
          dronesAboard: snapshot.ship.dronesAboard,
        },
        target: snapshot.target === null ? null : {
          kind: snapshot.target.kind,
          id: snapshot.target.id,
          name: snapshot.target.name,
          distance: Number(snapshot.target.distanceToSurface.toFixed(1)),
          relativeSpeed: Number(snapshot.target.relativeSpeed.toFixed(2)),
          size: snapshot.target.sizeClass,
          resource: snapshot.target.resourceType,
          tier: snapshot.target.resourceTier,
          yield: snapshot.target.remainingYield,
        },
        navigation: {
          open: this.navigationOpen,
          beacon: snapshot.navigationBeacon,
          autopilotAvailable: snapshot.autopilotAvailable,
          autopilot: snapshot.autopilot,
          mappedDestinations: this.navigationOpen
            ? navigationDestinations.map((destination) => ({
                id: destination.id,
                kind: destination.kind,
                name: destination.name,
                x: destination.position.x,
                y: destination.position.y,
              }))
            : undefined,
        },
        camera: {
          zoom: Number(this.cameraTelemetry.zoom.toFixed(3)),
          stationaryZoomMultiplier: this.settings.value.stationaryZoomMultiplier,
          maximumSpeedZoomMultiplier: this.settings.value.maximumSpeedZoomMultiplier,
        },
        stations: [...this.simulation.entities.stations.values()].map((station) => ({
          id: station.id,
          destinationId: station.destinationId,
          code: station.code,
          name: station.name,
          x: station.transform.position.x,
          y: station.transform.position.y,
        })),
        traders: snapshot.traders.map((trader) => ({
          id: trader.id,
          name: trader.name,
          state: trader.state,
          x: Number(trader.position.x.toFixed(1)),
          y: Number(trader.position.y.toFixed(1)),
          speed: Number(trader.speed.toFixed(1)),
          destinationStationId: trader.destinationStationId,
          routeLegs: trader.route.length,
        })),
        trackableAsteroids: snapshot.trackableAsteroids.map((asteroid) => ({
          id: asteroid.id,
          name: asteroid.name,
          x: Number(asteroid.position.x.toFixed(1)),
          y: Number(asteroid.position.y.toFixed(1)),
          structuralIntegrity: Number(asteroid.structuralIntegrity.toFixed(1)),
          maximumStructuralIntegrity: Number(asteroid.maximumStructuralIntegrity.toFixed(1)),
        })),
        dockedStation: snapshot.dockedStation,
        mining: snapshot.mining,
        objective: snapshot.objective,
        nearbyAsteroids,
        deployedDrones: snapshot.ship.dronesDeployed,
        debrisCount: this.simulation.entities.debris.size,
        asteroidCount: this.simulation.entities.asteroids.size,
      });
    };
    window.advanceTime = (milliseconds) => {
      bridge.advanceSimulation(Math.max(0, milliseconds) / 1000);
    };
  }

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.saveCareer();
      if (!this.stationOpen) {
        this.setPaused(true);
      }
    }
  };

  private readonly handleOrientationChange = (): void => {
    if (this.input.mode === 'tilt' && !this.stationOpen) {
      this.setPaused(true, 'ORIENTATION CHANGED // RECALIBRATE TILT BEFORE RESUMING');
    }
  };

  private readonly handleBeforeUnload = (): void => {
    this.saveCareer();
    this.input.setSuspended(true);
  };
}
