import type { PlayerSettings, PlayerSettingsStore } from '../app/PlayerSettings';
import { GAME_TITLE, GAME_VERSION } from '../game/config/constants';
import { moduleDefinitions, resourceDefinitions, type ModuleId } from '../data/gameData';
import { navigationDestinations } from '../data/navigationData';
import { tuning } from '../game/config/tuning';
import type { FlightActionState, InputMode } from '../game/input/InputActions';
import type { TiltStatus } from '../game/input/TiltController';
import type { CameraTelemetry } from '../game/rendering/CameraRig';
import type { CollisionOccurredEvent } from '../game/simulation/events';
import type { SimulationDebugSnapshot } from '../game/simulation/GameSimulation';
import type { SimulationClockStats } from '../game/simulation/SimulationClock';
import type { HardpointId } from '../game/simulation/components';
import type { VirtualJoystickElements } from '../game/input/VirtualJoystick';
import {
  calculateCargoValue,
  getMountedModuleCount,
  getOwnedModuleCount,
  type CareerState,
} from '../progression/CareerState';

export interface HudHandlers {
  onPauseToggle: () => void;
  onModeRequested: (mode: InputMode) => void;
  onTiltCalibrate: () => void;
  onResetSimulation: () => void;
  onResetCareer: () => void;
  onLaunch: () => void;
  onContextAction: () => void;
  onNavigationToggle: () => void;
  onNavigationDestinationSelected: (destinationId: string) => void;
  onNavigationEntitySelected: (kind: 'trader' | 'asteroid', entityId: number) => void;
  onAutopilotToggle: () => void;
  onStrafeHold: (direction: number) => void;
  onSellAll: () => void;
  onPurchaseModule: (moduleId: string) => void;
  onMountModule: (moduleId: string, hardpoint: HardpointId) => void;
  onUnmountHardpoint: (hardpoint: HardpointId) => void;
  onServiceShip: () => void;
}

export interface HudFrameData {
  snapshot: SimulationDebugSnapshot;
  clock: SimulationClockStats;
  fps: number;
  actions: FlightActionState;
  camera: CameraTelemetry;
  career: Readonly<CareerState>;
}

export interface TargetMarkerData {
  x: number;
  y: number;
  angle: number;
  label: string;
  kind: 'asteroid' | 'station' | 'trader';
}

type ToastTone = 'info' | 'warning' | 'danger';

const requireElement = <T extends Element>(root: ParentNode, selector: string): T => {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing required HUD element: ${selector}`);
  }
  return element;
};

const percent = (value: number, maximum: number): number =>
  maximum > 0 ? Math.min(100, Math.max(0, (value / maximum) * 100)) : 0;

const formatDistance = (metres: number): string =>
  metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${metres.toFixed(metres < 100 ? 1 : 0)} m`;

const formatCredits = (credits: number): string => `${Math.floor(credits).toLocaleString('en-US')} CR`;

const moduleSpritePaths: Record<ModuleId, string> = {
  'mining-drone': './assets/sprites/drone_miner_v3.png',
  'engine-kestrel': './assets/sprites/module_engine_v2.png',
  'retro-brace': './assets/sprites/module_retro_v2.png',
  'cargo-saddles': './assets/sprites/module_cargo_v2.png',
  'flight-assist': './assets/sprites/module_assist_v2.png',
};

const assetUrl = (path: string): string => window.__BELTER_ASSET_DATA__?.[path] ?? path;

export class HudRoot {
  private readonly shell: HTMLElement;
  private readonly canvasHost: HTMLElement;
  private readonly pausePanel: HTMLElement;
  private readonly stationPanel: HTMLElement;
  private readonly navigationPanel: HTMLElement;
  private readonly debugPanel: HTMLElement;
  private readonly targetPanel: HTMLElement;
  private readonly targetMarker: HTMLElement;
  private readonly targetMarkerArrow: HTMLElement;
  private readonly targetMarkerLabel: HTMLElement;
  private readonly impactChip: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly hullBar: HTMLElement;
  private readonly fuelBar: HTMLElement;
  private readonly cargoBar: HTMLElement;
  private readonly droneBar: HTMLElement;
  private readonly hullValue: HTMLElement;
  private readonly fuelValue: HTMLElement;
  private readonly cargoValue: HTMLElement;
  private readonly droneValue: HTMLElement;
  private readonly speedValue: HTMLElement;
  private readonly relativeSpeedValue: HTMLElement;
  private readonly objectiveValue: HTMLElement;
  private readonly modeValue: HTMLElement;
  private readonly thrustValue: HTMLElement;
  private readonly creditsValue: HTMLElement;
  private readonly targetName: HTMLElement;
  private readonly targetType: HTMLElement;
  private readonly targetDistance: HTMLElement;
  private readonly targetRelative: HTMLElement;
  private readonly targetResource: HTMLElement;
  private readonly targetYield: HTMLElement;
  private readonly approachValue: HTMLElement;
  private readonly miningState: HTMLElement;
  private readonly miningProgress: HTMLElement;
  private readonly contextButton: HTMLButtonElement;
  private readonly navigationButton: HTMLButtonElement;
  private readonly navigationShipMarker: HTMLElement;
  private readonly navigationTraderMarker: HTMLButtonElement;
  private readonly navigationAsteroidMarkers: HTMLElement;
  private readonly navigationContacts: HTMLElement;
  private readonly navigationAutopilotButton: HTMLButtonElement;
  private readonly navigationStatus: HTMLElement;
  private readonly navigationSystemLabel: HTMLElement;
  private readonly navigationWarning: HTMLElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly calibrateButton: HTMLButtonElement;
  private readonly quickCalibrateButton: HTMLButtonElement;
  private readonly tiltStatusValue: HTMLElement;
  private readonly modeButtons: HTMLButtonElement[];
  private readonly debugContent: HTMLElement;
  private readonly stationCredits: HTMLElement;
  private readonly stationCode: HTMLElement;
  private readonly stationName: HTMLElement;
  private readonly stationServices: HTMLElement;
  private readonly stationBerth: HTMLElement;
  private readonly stationCargo: HTMLElement;
  private readonly stationSaleValue: HTMLElement;
  private readonly stationLoopStatus: HTMLElement;
  private readonly stationShipStats: HTMLElement;
  private readonly stationShipPreview: HTMLElement;
  private readonly moduleList: HTMLElement;
  private readonly sellAllButton: HTMLButtonElement;
  private readonly joystick: VirtualJoystickElements;
  private readonly abortController = new AbortController();
  private readonly unsubscribeSettings: () => void;
  private handlers: HudHandlers | null = null;
  private toastTimer: number | null = null;
  private impactTimer: number | null = null;
  private readonly strafeHeld = new Set<number>();

  public constructor(
    root: HTMLElement,
    private readonly settings: PlayerSettingsStore,
  ) {
    root.innerHTML = this.template();
    this.shell = requireElement(root, '.belter-shell');
    this.canvasHost = requireElement(root, '#game-canvas-host');
    this.pausePanel = requireElement(root, '#pause-panel');
    this.stationPanel = requireElement(root, '#station-panel');
    this.navigationPanel = requireElement(root, '#navigation-panel');
    this.debugPanel = requireElement(root, '#debug-panel');
    this.targetPanel = requireElement(root, '#target-panel');
    this.targetMarker = requireElement(root, '#target-marker');
    this.targetMarkerArrow = requireElement(root, '#target-marker-arrow');
    this.targetMarkerLabel = requireElement(root, '#target-marker-label');
    this.impactChip = requireElement(root, '#impact-chip');
    this.toast = requireElement(root, '#toast');
    this.hullBar = requireElement(root, '#hull-bar-fill');
    this.fuelBar = requireElement(root, '#fuel-bar-fill');
    this.cargoBar = requireElement(root, '#cargo-bar-fill');
    this.droneBar = requireElement(root, '#drone-bar-fill');
    this.hullValue = requireElement(root, '#hull-value');
    this.fuelValue = requireElement(root, '#fuel-value');
    this.cargoValue = requireElement(root, '#cargo-value');
    this.droneValue = requireElement(root, '#drone-value');
    this.speedValue = requireElement(root, '#speed-value');
    this.relativeSpeedValue = requireElement(root, '#relative-speed-value');
    this.objectiveValue = requireElement(root, '#objective-value');
    this.modeValue = requireElement(root, '#mode-value');
    this.thrustValue = requireElement(root, '#thrust-value');
    this.creditsValue = requireElement(root, '#credits-value');
    this.targetName = requireElement(root, '#target-name');
    this.targetType = requireElement(root, '#target-type');
    this.targetDistance = requireElement(root, '#target-distance');
    this.targetRelative = requireElement(root, '#target-relative');
    this.targetResource = requireElement(root, '#target-resource');
    this.targetYield = requireElement(root, '#target-yield');
    this.approachValue = requireElement(root, '#approach-value');
    this.miningState = requireElement(root, '#mining-state');
    this.miningProgress = requireElement(root, '#mining-progress-fill');
    this.contextButton = requireElement(root, '#context-button');
    this.navigationButton = requireElement(root, '#navigation-button');
    this.navigationShipMarker = requireElement(root, '#navigation-ship-marker');
    this.navigationTraderMarker = requireElement(root, '#navigation-trader-marker');
    this.navigationAsteroidMarkers = requireElement(root, '#navigation-asteroid-markers');
    this.navigationContacts = requireElement(root, '#navigation-contacts');
    this.navigationAutopilotButton = requireElement(root, '#navigation-autopilot');
    this.navigationStatus = requireElement(root, '#navigation-status');
    this.navigationSystemLabel = requireElement(root, '#navigation-system-label');
    this.navigationWarning = requireElement(root, '#navigation-warning');
    this.pauseButton = requireElement(root, '#pause-button');
    this.calibrateButton = requireElement(root, '#calibrate-tilt');
    this.quickCalibrateButton = requireElement(root, '#quick-calibrate');
    this.tiltStatusValue = requireElement(root, '#tilt-status-value');
    this.modeButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-control-mode]')];
    this.debugContent = requireElement(root, '#debug-content');
    this.stationCredits = requireElement(root, '#station-credits');
    this.stationCode = requireElement(root, '#station-code');
    this.stationName = requireElement(root, '#station-name');
    this.stationServices = requireElement(root, '#station-services');
    this.stationBerth = requireElement(root, '#station-berth');
    this.stationCargo = requireElement(root, '#station-cargo');
    this.stationSaleValue = requireElement(root, '#station-sale-value');
    this.stationLoopStatus = requireElement(root, '#station-loop-status');
    this.stationShipStats = requireElement(root, '#station-ship-stats');
    this.stationShipPreview = requireElement(root, '#station-ship-preview');
    this.moduleList = requireElement(root, '#module-list');
    this.sellAllButton = requireElement(root, '#sell-all-button');
    this.joystick = {
      root: requireElement(root, '#virtual-joystick'),
      pad: requireElement(root, '#joystick-pad'),
      knob: requireElement(root, '#joystick-knob'),
    };

    this.attachStaticListeners(root);
    this.unsubscribeSettings = settings.subscribe((value) => {
      this.applySettingsToControls(value);
    });
  }

  public bindHandlers(handlers: HudHandlers): void {
    this.handlers = handlers;
  }

  public get canvasParent(): HTMLElement {
    return this.canvasHost;
  }

  public get joystickElements(): VirtualJoystickElements {
    return this.joystick;
  }

  public setMode(mode: InputMode): void {
    this.shell.dataset.controlMode = mode;
    this.modeValue.textContent = mode.toUpperCase();
    const joystickVisible = mode === 'joystick';
    this.joystick.root.setAttribute('aria-hidden', String(!joystickVisible));
    this.quickCalibrateButton.hidden = mode !== 'tilt';
    for (const button of this.modeButtons) {
      button.toggleAttribute('data-active', button.dataset.controlMode === mode);
    }
  }

  public setTiltStatus(status: TiltStatus): void {
    const calibrated = status.calibrated ? 'CALIBRATED' : 'UNCALIBRATED';
    this.tiltStatusValue.textContent = `${status.permission.toUpperCase()} // ${calibrated}`;
  }

  public setPaused(paused: boolean): void {
    this.pausePanel.toggleAttribute('data-open', paused);
    this.pausePanel.setAttribute('aria-hidden', String(!paused));
    this.pauseButton.textContent = paused ? 'RESUME' : 'PAUSE';
    if (paused) {
      this.releaseStrafe();
    }
  }

  public setStationOpen(open: boolean): void {
    this.stationPanel.toggleAttribute('data-open', open);
    this.stationPanel.setAttribute('aria-hidden', String(!open));
    this.shell.toggleAttribute('data-station-open', open);
    if (open) {
      this.releaseStrafe();
      this.setTargetMarker(null);
    }
  }

  public setNavigationOpen(open: boolean, snapshot?: SimulationDebugSnapshot): void {
    this.navigationPanel.toggleAttribute('data-open', open);
    this.navigationPanel.setAttribute('aria-hidden', String(!open));
    this.shell.toggleAttribute('data-navigation-open', open);
    if (open) {
      this.releaseStrafe();
      if (snapshot !== undefined) {
        this.updateNavigationMap(snapshot);
      }
    }
  }

  public updateNavigationMap(snapshot: SimulationDebugSnapshot): void {
    const mapPercent = (value: number): number => Math.min(
      100,
      Math.max(0, 50 + value / tuning.sectorHalfExtent * 50),
    );
    this.navigationShipMarker.style.left = `${mapPercent(snapshot.ship.position.x)}%`;
    this.navigationShipMarker.style.top = `${mapPercent(snapshot.ship.position.y)}%`;
    const trader = snapshot.traders[0];
    this.navigationTraderMarker.toggleAttribute('data-visible', trader !== undefined);
    if (trader !== undefined) {
      this.navigationTraderMarker.style.left = `${mapPercent(trader.position.x)}%`;
      this.navigationTraderMarker.style.top = `${mapPercent(trader.position.y)}%`;
      this.navigationTraderMarker.dataset.navigationEntityKind = 'trader';
      this.navigationTraderMarker.dataset.navigationEntityId = String(trader.id);
      this.navigationTraderMarker.toggleAttribute(
        'data-active',
        snapshot.navigationBeacon?.id === `trader:${trader.id}`,
      );
      this.navigationTraderMarker.querySelector('span')!.textContent = trader.state === 'docked'
        ? 'FT-LARK // DOCKED'
        : 'FT-LARK // TRANSIT';
    }
    this.navigationAsteroidMarkers.replaceChildren(...snapshot.trackableAsteroids.map((asteroid) => {
      const button = document.createElement('button');
      button.className = 'navigation-massif-marker';
      button.type = 'button';
      button.style.left = `${mapPercent(asteroid.position.x)}%`;
      button.style.top = `${mapPercent(asteroid.position.y)}%`;
      button.dataset.navigationEntityKind = 'asteroid';
      button.dataset.navigationEntityId = String(asteroid.id);
      button.toggleAttribute('data-active', snapshot.navigationBeacon?.id === `asteroid:${asteroid.id}`);
      button.setAttribute('aria-label', `Set navigation for ${asteroid.name}`);
      button.innerHTML = `<i></i><span>${asteroid.code}</span>`;
      return button;
    }));
    const contacts = [
      ...snapshot.traders.map((contact) => ({
        kind: 'trader' as const,
        id: contact.id,
        code: contact.code,
        name: contact.name,
        detail: contact.state === 'docked' ? 'DOCKED' : `${contact.speed.toFixed(0)} M/S`,
        position: contact.position,
      })),
      ...snapshot.trackableAsteroids.map((contact) => ({
        kind: 'asteroid' as const,
        id: contact.id,
        code: contact.code,
        name: contact.name,
        detail: `STRUCT ${Math.round(
          contact.structuralIntegrity / Math.max(0.001, contact.maximumStructuralIntegrity) * 100,
        )}%`,
        position: contact.position,
      })),
    ];
    this.navigationContacts.replaceChildren(...contacts.map((contact) => {
      const button = document.createElement('button');
      button.className = 'navigation-contact-row';
      button.type = 'button';
      button.dataset.navigationEntityKind = contact.kind;
      button.dataset.navigationEntityId = String(contact.id);
      button.toggleAttribute(
        'data-active',
        snapshot.navigationBeacon?.id === `${contact.kind}:${contact.id}`,
      );
      const range = Math.hypot(
        contact.position.x - snapshot.ship.position.x,
        contact.position.y - snapshot.ship.position.y,
      );
      button.innerHTML = `<span><small>${contact.code}</small><b>${contact.name}</b></span><em>${formatDistance(range)}</em><strong>${contact.detail}</strong>`;
      return button;
    }));
    this.navigationSystemLabel.textContent = snapshot.autopilotAvailable
      ? 'MULE-01 // WAYFINDER AUTOPILOT ONLINE'
      : 'MULE-01 // STANDARD NAVIGATION';
    this.navigationStatus.textContent = snapshot.navigationBeacon === null
      ? 'NO NAVIGATION DESTINATION SELECTED'
      : `${snapshot.autopilot.enabled
        ? `AUTOPILOT ${snapshot.autopilot.status.toUpperCase()}`
        : `ROUTE ${snapshot.autopilot.status.toUpperCase()} // MANUAL FLIGHT`} // ${snapshot.navigationBeacon.code} // ${formatDistance(snapshot.navigationBeacon.distance)}`;
    this.navigationAutopilotButton.disabled = !snapshot.autopilotAvailable
      || snapshot.navigationBeacon === null;
    this.navigationAutopilotButton.textContent = snapshot.autopilot.enabled
      ? 'DISENGAGE AUTOPILOT'
      : snapshot.autopilotAvailable
        ? 'ENGAGE AUTOPILOT'
        : 'WAYFINDER REQUIRED';
    this.navigationWarning.textContent = snapshot.autopilotAvailable
      ? 'MAP SELECTION PLOTS A GUIDE ROUTE ONLY. ENGAGE WAYFINDER SEPARATELY; ANY MANUAL FLIGHT INPUT DISENGAGES IT.'
      : 'NAVIGATION BEACONS AND DIRECTION POINTERS ARE STANDARD. INSTALL WAYFINDER TO FOLLOW ROUTES AND CLOSE SAFELY WITH ASTEROIDS.';
    for (const button of this.navigationPanel.querySelectorAll<HTMLElement>('[data-navigation-id]')) {
      button.toggleAttribute('data-active', button.dataset.navigationId === snapshot.navigationBeacon?.id);
    }
    for (const distanceValue of this.navigationPanel.querySelectorAll<HTMLElement>('[data-navigation-distance]')) {
      const destination = navigationDestinations.find(
        (candidate) => candidate.id === distanceValue.dataset.navigationDistance,
      );
      if (destination !== undefined) {
        distanceValue.textContent = formatDistance(Math.hypot(
          destination.position.x - snapshot.ship.position.x,
          destination.position.y - snapshot.ship.position.y,
        ));
      }
    }
  }

  public updateFlight(data: HudFrameData): void {
    const { snapshot } = data;
    const { ship } = snapshot;
    this.hullBar.style.width = `${percent(ship.hull, ship.maxHull).toFixed(1)}%`;
    this.fuelBar.style.width = `${percent(ship.fuel, ship.fuelCapacity).toFixed(1)}%`;
    this.cargoBar.style.width = `${percent(ship.cargoMass, ship.cargoCapacity).toFixed(1)}%`;
    this.droneBar.style.width = `${percent(ship.dronesAboard, ship.maxDrones).toFixed(1)}%`;
    this.hullValue.textContent = `${Math.round(percent(ship.hull, ship.maxHull))}%`;
    this.fuelValue.textContent = `${Math.round(percent(ship.fuel, ship.fuelCapacity))}%`;
    this.cargoValue.textContent = `${ship.cargoMass.toFixed(1)} / ${ship.cargoCapacity.toFixed(0)} t`;
    this.droneValue.textContent = `${ship.dronesAboard} + ${ship.dronesDeployed} / ${ship.maxDrones}`;
    const speedWarning = ship.speed >= tuning.velocityVectorWarningSpeed;
    this.speedValue.textContent = `${speedWarning ? '⚠ ' : ''}${ship.speed.toFixed(1)} m/s`;
    this.speedValue.dataset.state = ship.speed >= tuning.velocityVectorRedSpeed
      ? 'danger'
      : speedWarning
        ? 'warning'
        : 'normal';
    this.relativeSpeedValue.textContent = snapshot.target === null
      ? '—'
      : `${snapshot.target.relativeSpeed.toFixed(2)} m/s`;
    this.objectiveValue.textContent = snapshot.objective;
    this.creditsValue.textContent = formatCredits(data.career.credits);

    const netThrust = snapshot.appliedActions.thrustForward - snapshot.appliedActions.thrustReverse;
    const thrustLabel = netThrust > 0.01
      ? `FWD ${(netThrust * 100).toFixed(0)}%`
      : netThrust < -0.01
        ? `REV ${(-netThrust * 100).toFixed(0)}%`
        : 'COAST';
    const strafeLabel = Math.abs(snapshot.appliedActions.strafe) > 0.01
      ? ` // LAT ${(snapshot.appliedActions.strafe * 100).toFixed(0)}%`
      : '';
    this.thrustValue.textContent = `${thrustLabel} // ROT ${(snapshot.appliedActions.steer * 100).toFixed(0)}%${strafeLabel}`;

    const target = snapshot.target;
    this.targetPanel.toggleAttribute('data-visible', target !== null);
    if (target !== null) {
      this.targetName.textContent = target.name;
      this.targetType.textContent = target.kind === 'station'
        ? 'STATION BEACON'
        : target.kind === 'trader'
          ? 'INDEPENDENT SHIP // TRANSPONDER'
          : `${target.sizeClass?.toUpperCase() ?? 'ASTEROID'} // ${target.materialClass?.toUpperCase() ?? 'UNKNOWN'} // ${target.shapeClass?.toUpperCase() ?? 'LOCK'}`;
      this.targetDistance.textContent = formatDistance(target.distanceToSurface);
      this.targetRelative.textContent = `${target.relativeSpeed.toFixed(2)} m/s`;
      this.targetResource.textContent = target.kind === 'asteroid'
        ? `${target.resourceTierLabel.toUpperCase()} // ${target.resourceLabel}`
        : target.resourceLabel;
      this.targetYield.textContent = target.remainingYield === null
        ? target.kind === 'station' ? 'DOCKING SERVICES' : 'TRACKABLE CONTACT'
        : target.resourceLabel === 'Barren rock'
          ? `NO RECOVERABLE MATERIAL // STRUCT ${Math.round(
              ((target.structuralIntegrity ?? 0) / Math.max(0.001, target.maximumStructuralIntegrity ?? 1)) * 100,
            )}%`
          : `${target.remainingYield.toFixed(1)} t // ${Math.round((target.yieldPercent ?? 0) * 100)}% // STAB ${Math.round((target.stability ?? 0) * 100)}% // STRUCT ${Math.round(
              ((target.structuralIntegrity ?? 0) / Math.max(0.001, target.maximumStructuralIntegrity ?? 1)) * 100,
            )}%`;
      this.approachValue.textContent = target.timeToClosestApproach > 0.05
        ? `${target.closestApproachDistance.toFixed(0)} m in ${target.timeToClosestApproach.toFixed(1)} s`
        : `${target.closestApproachDistance.toFixed(0)} m projected`;
    }

    const miningLabel = snapshot.mining.status.replace('-', ' ').toUpperCase();
    this.miningState.textContent = miningLabel;
    this.miningState.dataset.state = snapshot.mining.status;
    this.miningProgress.style.width = `${(snapshot.mining.stableProgress * 100).toFixed(1)}%`;

    this.contextButton.textContent = snapshot.contextActionLabel;
    this.contextButton.disabled = !snapshot.contextActionEnabled;
    this.contextButton.toggleAttribute(
      'data-active',
      snapshot.assistEnabled || snapshot.autopilot.enabled || snapshot.ship.dronesDeployed > 0,
    );
    this.navigationButton.hidden = snapshot.phase === 'station' || snapshot.phase === 'disabled';
    this.pauseButton.hidden = snapshot.phase === 'station';

    this.shell.dataset.phase = snapshot.phase;
    this.shell.dataset.cameraAnchorY = data.camera.anchorY.toFixed(4);
    this.shell.dataset.cameraZoom = data.camera.zoom.toFixed(4);
    this.debugContent.textContent = [
      `tick        ${snapshot.tick}`,
      `phase       ${snapshot.phase}`,
      `sim time    ${snapshot.elapsedSeconds.toFixed(2)} s`,
      `step count  ${data.clock.steps}`,
      `interp      ${data.clock.interpolationAlpha.toFixed(3)}`,
      `dropped     ${data.clock.droppedSeconds.toFixed(4)} s`,
      `fps         ${data.fps.toFixed(1)}`,
      `entities    ${snapshot.entityCount}`,
      `position    ${ship.position.x.toFixed(2)}, ${ship.position.y.toFixed(2)} m`,
      `velocity    ${ship.velocity.x.toFixed(2)}, ${ship.velocity.y.toFixed(2)} m/s`,
      `relative    ${target?.relativeSpeed.toFixed(3) ?? '—'} m/s`,
      `heading     ${(ship.heading * 180 / Math.PI).toFixed(1)}°`,
      `mass        ${ship.mass.toFixed(1)} t`,
      `accel       ${ship.accelerationPotential.toFixed(2)} m/s²`,
      `mining      ${snapshot.mining.status}`,
      `assist      ${snapshot.assistMode}`,
      `autopilot   ${snapshot.autopilot.status} // ${snapshot.autopilot.path.length} legs`,
      `camera      ${data.camera.zoom.toFixed(2)}× @ ${(data.camera.anchorY * 100).toFixed(1)}%`,
    ].join('\n');
  }

  public updateStation(career: Readonly<CareerState>, snapshot: SimulationDebugSnapshot): void {
    const cargo = snapshot.ship.cargo;
    const saleValue = calculateCargoValue(cargo);
    this.stationCredits.textContent = formatCredits(career.credits);
    this.stationCode.textContent = `PORT AUTHORITY // ${snapshot.dockedStation.code}`;
    this.stationName.textContent = snapshot.dockedStation.name.toUpperCase();
    this.stationServices.textContent = snapshot.dockedStation.destinationId === 'pallas-gate'
      ? 'TRANSFER DECK // FUEL • SERVICE • CARGO'
      : 'CONCOURSE 2 // TRADE • SERVICE • OUTFITTING';
    this.stationBerth.textContent = snapshot.dockedStation.destinationId === 'pallas-gate'
      ? 'BERTH 02 // TRANSFER LOCK'
      : 'BERTH 04 // HARD SEAL';
    this.stationCargo.textContent = `${snapshot.ship.cargoMass.toFixed(1)} / ${snapshot.ship.cargoCapacity.toFixed(0)} t`;
    this.stationSaleValue.textContent = formatCredits(saleValue);
    this.sellAllButton.disabled = snapshot.ship.cargoMass <= 0;
    this.stationLoopStatus.textContent = career.tutorialComplete
      ? `VERTICAL SLICE COMPLETE // ${career.stats.expeditionsCompleted} EXPEDITIONS // PROGRESSION SAVED`
      : snapshot.ship.cargoMass > 0
        ? 'RETURN CONFIRMED // SELL CARGO, THEN INSTALL AN UPGRADE'
        : career.stats.resourcesSold > 0
          ? 'MARKET SALE COMPLETE // INSTALL AN UPGRADE'
          : 'FIRST RUN // LAUNCH, MINE M-12, RECALL, AND RETURN';
    this.stationLoopStatus.dataset.complete = String(career.tutorialComplete);

    const cargoRows = (Object.keys(resourceDefinitions) as Array<keyof typeof resourceDefinitions>)
      .map((resource) => {
        const definition = resourceDefinitions[resource];
        return `<div><span>${definition.shortLabel}</span><b>${cargo[resource].toFixed(1)} t</b><em>${definition.unitPrice} CR/t</em></div>`;
      })
      .join('');
    requireElement<HTMLElement>(this.stationPanel, '#market-resource-rows').innerHTML = cargoRows;

    this.stationShipStats.innerHTML = [
      `<div><span>DRY MASS</span><b>${snapshot.ship.dryMass.toFixed(1)} t</b></div>`,
      `<div><span>MAIN THRUST</span><b>${snapshot.ship.forwardThrust.toFixed(0)} kN</b></div>`,
      `<div><span>RETRO THRUST</span><b>${snapshot.ship.reverseThrust.toFixed(0)} kN</b></div>`,
      `<div><span>ACCELERATION</span><b>${snapshot.ship.accelerationPotential.toFixed(2)} m/s²</b></div>`,
      `<div><span>CARGO LIMIT</span><b>${snapshot.ship.cargoCapacity.toFixed(0)} t</b></div>`,
    ].join('');

    this.stationShipPreview.innerHTML = `
      <div class="ship-preview-rig">
        <img class="ship-preview-layer ship-preview-base" src="${assetUrl('./assets/sprites/ship_hauler_v1.png')}" alt="Mule-01 hauler" />
        ${(['port', 'starboard', 'ventral'] as const).map((hardpoint) => {
          const moduleId = career.hardpointLoadout[hardpoint];
          if (moduleId === null) {
            return `<span class="ship-preview-empty ship-preview-${hardpoint}">${hardpoint.toUpperCase()}</span>`;
          }
          const condition = career.hardpointCondition[hardpoint];
          return `
            <img class="ship-preview-layer ship-preview-equipment ship-preview-${hardpoint}"
              src="${assetUrl(moduleSpritePaths[moduleId])}"
              alt="${moduleDefinitions[moduleId].displayName} on ${hardpoint} hardpoint"
              data-condition="${condition <= 0 ? 'disabled' : condition < 45 ? 'damaged' : 'ready'}" />
          `;
        }).join('')}
      </div>
      <div class="ship-preview-clear-buttons">
        ${(['port', 'starboard', 'ventral'] as const).map((hardpoint) => `
          <button type="button" data-unmount-hardpoint="${hardpoint}"
            ${career.hardpointLoadout[hardpoint] === null ? 'disabled' : ''}>
            CLEAR ${hardpoint === 'starboard' ? 'STBD' : hardpoint.toUpperCase()}
          </button>
        `).join('')}
      </div>
      <span>UNIVERSAL HARDPOINTS // ${Object.values(career.hardpointLoadout).filter((moduleId) => moduleId !== null).length} / 3 OCCUPIED</span>
    `;

    this.moduleList.innerHTML = (Object.values(moduleDefinitions)).map((module) => {
      const ownedCount = getOwnedModuleCount(career, module.id);
      const mountedCount = getMountedModuleCount(career, module.id);
      const owned = ownedCount > 0;
      const installed = module.mounting === 'internal' ? owned : mountedCount > 0;
      const affordable = career.credits >= module.purchasePrice
        && !(module.mounting === 'internal' && owned);
      const mountedHardpoint = (['port', 'starboard', 'ventral'] as const).find(
        (hardpoint) => career.hardpointLoadout[hardpoint] === module.id,
      );
      const buttonLabel = module.mounting === 'internal' && owned
        ? 'INSTALLED'
        : owned
          ? `BUY ADD'L // ${module.purchasePrice} CR`
        : `BUY // ${module.purchasePrice} CR`;
      const installationStatus = module.mounting === 'internal'
        ? `${module.category.toUpperCase()} // INTERNAL // ${installed ? 'INSTALLED' : 'AVAILABLE'}`
        : `${module.category.toUpperCase()} // ${ownedCount} OWNED // ${mountedCount} MOUNTED`;
      return `
        <article class="module-card" data-installed="${String(installed)}" data-module="${module.id}">
          <div class="module-silhouette module-${module.category}" aria-hidden="true">
            <img src="${assetUrl(moduleSpritePaths[module.id])}" alt="" />
          </div>
          <div class="module-copy">
            <header><span>${installationStatus}</span><b>${module.displayName}</b></header>
            <p>${module.description}</p>
          </div>
          <div class="module-actions">
            <button class="module-buy-button" type="button" data-module-id="${module.id}" ${!affordable ? 'disabled' : ''}>${buttonLabel}</button>
            ${module.mounting === 'internal'
              ? '<div class="internal-installation">INTERNAL SYSTEM // NO HARDPOINT REQUIRED</div>'
              : `<div class="hardpoint-mount-buttons" aria-label="Mount ${module.displayName}">
                ${(['port', 'starboard', 'ventral'] as const).map((hardpoint) => `
                  <button type="button" data-mount-module="${module.id}" data-hardpoint="${hardpoint}"
                    ${!owned || mountedHardpoint === hardpoint ? 'disabled' : ''}>
                    ${hardpoint === 'starboard' ? 'STBD' : hardpoint.toUpperCase()}
                    ${mountedHardpoint === hardpoint ? ` ${Math.round(career.hardpointCondition[hardpoint])}%` : ''}
                  </button>
                `).join('')}
              </div>`}
          </div>
        </article>
      `;
    }).join('');
  }

  public setTargetMarker(marker: TargetMarkerData | null): void {
    this.targetMarker.toggleAttribute('data-visible', marker !== null);
    if (marker === null) {
      return;
    }
    this.targetMarker.style.left = `${marker.x}px`;
    this.targetMarker.style.top = `${marker.y}px`;
    this.targetMarker.dataset.kind = marker.kind;
    this.targetMarkerArrow.style.transform = `rotate(${marker.angle}rad)`;
    this.targetMarkerLabel.textContent = marker.label;
  }

  public reportImpact(event: CollisionOccurredEvent): void {
    if (this.impactTimer !== null) {
      window.clearTimeout(this.impactTimer);
    }
    this.impactChip.dataset.severity = event.severity;
    const objectLabel = event.objectKind === 'debris'
      ? 'DEBRIS'
      : event.objectKind === 'trader'
        ? 'SHIP'
        : 'ASTEROID';
    const damageText = event.damage > 0.05 ? ` // −${event.damage.toFixed(0)} HULL` : '';
    this.impactChip.textContent = `${objectLabel} IMPACT ${event.relativeSpeed.toFixed(1)} m/s${damageText}`;
    this.impactChip.toggleAttribute('data-visible', true);
    this.impactTimer = window.setTimeout(() => {
      this.impactChip.toggleAttribute('data-visible', false);
    }, 2800);
  }

  public showToast(message: string, tone: ToastTone = 'info', durationMs = 2800): void {
    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
    }
    this.toast.textContent = message;
    this.toast.dataset.tone = tone;
    this.toast.toggleAttribute('data-visible', true);
    this.toastTimer = window.setTimeout(() => {
      this.toast.toggleAttribute('data-visible', false);
    }, durationMs);
  }

  public destroy(): void {
    this.releaseStrafe();
    this.abortController.abort();
    this.unsubscribeSettings();
    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
    }
    if (this.impactTimer !== null) {
      window.clearTimeout(this.impactTimer);
    }
  }

  private attachStaticListeners(root: HTMLElement): void {
    const signal = this.abortController.signal;
    this.pauseButton.addEventListener('click', () => this.handlers?.onPauseToggle(), { signal });
    requireElement<HTMLButtonElement>(root, '#resume-button').addEventListener('click', () => this.handlers?.onPauseToggle(), { signal });
    requireElement<HTMLButtonElement>(root, '#reset-expedition').addEventListener('click', () => this.handlers?.onResetSimulation(), { signal });
    requireElement<HTMLButtonElement>(root, '#reset-career').addEventListener('click', () => this.handlers?.onResetCareer(), { signal });
    requireElement<HTMLButtonElement>(root, '#launch-button').addEventListener('click', () => this.handlers?.onLaunch(), { signal });
    this.contextButton.addEventListener('click', () => this.handlers?.onContextAction(), { signal });
    this.navigationButton.addEventListener('click', () => this.handlers?.onNavigationToggle(), { signal });
    requireElement<HTMLButtonElement>(root, '#navigation-close').addEventListener(
      'click',
      () => this.handlers?.onNavigationToggle(),
      { signal },
    );
    this.navigationAutopilotButton.addEventListener(
      'click',
      () => this.handlers?.onAutopilotToggle(),
      { signal },
    );
    this.navigationPanel.addEventListener('click', (event) => {
      const button = (event.target as Element).closest<HTMLElement>('[data-navigation-entity-kind]');
      const kind = button?.dataset.navigationEntityKind;
      const entityId = Number(button?.dataset.navigationEntityId);
      if ((kind === 'trader' || kind === 'asteroid') && Number.isInteger(entityId)) {
        this.handlers?.onNavigationEntitySelected(kind, entityId);
      }
    }, { signal });
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-navigation-id]')) {
      button.addEventListener('click', () => {
        const destinationId = button.dataset.navigationId;
        if (destinationId !== undefined) {
          this.handlers?.onNavigationDestinationSelected(destinationId);
        }
      }, { signal });
    }
    this.sellAllButton.addEventListener('click', () => this.handlers?.onSellAll(), { signal });
    requireElement<HTMLButtonElement>(root, '#service-button').addEventListener('click', () => this.handlers?.onServiceShip(), { signal });
    this.calibrateButton.addEventListener('click', () => this.handlers?.onTiltCalibrate(), { signal });
    this.quickCalibrateButton.addEventListener('click', () => this.handlers?.onTiltCalibrate(), { signal });

    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-strafe]')) {
      const direction = Number(button.dataset.strafe);
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        this.strafeHeld.add(direction);
        button.toggleAttribute('data-active', true);
        this.updateStrafeHold();
      }, { signal });
      const release = (event: PointerEvent): void => {
        event.preventDefault();
        this.strafeHeld.delete(direction);
        button.toggleAttribute('data-active', false);
        this.updateStrafeHold();
      };
      button.addEventListener('pointerup', release, { signal });
      button.addEventListener('pointercancel', release, { signal });
      button.addEventListener('lostpointercapture', release, { signal });
    }

    this.moduleList.addEventListener('click', (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>('[data-module-id]');
      const moduleId = button?.dataset.moduleId;
      if (button !== null && moduleId !== undefined && !button.disabled) {
        this.handlers?.onPurchaseModule(moduleId);
      }
    }, { signal });
    this.stationShipPreview.addEventListener('click', (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>('[data-unmount-hardpoint]');
      const hardpoint = button?.dataset.unmountHardpoint as HardpointId | undefined;
      if (button !== null && hardpoint !== undefined && !button.disabled) {
        this.handlers?.onUnmountHardpoint(hardpoint);
      }
    }, { signal });
    this.moduleList.addEventListener('click', (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>('[data-mount-module]');
      const moduleId = button?.dataset.mountModule;
      const hardpoint = button?.dataset.hardpoint as HardpointId | undefined;
      if (button !== null && moduleId !== undefined && hardpoint !== undefined && !button.disabled) {
        this.handlers?.onMountModule(moduleId, hardpoint);
      }
    }, { signal });

    for (const button of this.modeButtons) {
      button.addEventListener('click', () => {
        const mode = button.dataset.controlMode as InputMode | undefined;
        if (mode !== undefined) {
          this.handlers?.onModeRequested(mode);
        }
      }, { signal });
    }

    requireElement<HTMLInputElement>(root, '#dynamic-zoom').addEventListener('change', (event) => {
      this.settings.patch({ dynamicZoom: (event.currentTarget as HTMLInputElement).checked });
    }, { signal });
    requireElement<HTMLInputElement>(root, '#reduced-motion').addEventListener('change', (event) => {
      this.settings.patch({ reducedMotion: (event.currentTarget as HTMLInputElement).checked });
    }, { signal });
    requireElement<HTMLInputElement>(root, '#invert-pitch').addEventListener('change', (event) => {
      this.settings.patch({ invertPitch: (event.currentTarget as HTMLInputElement).checked });
    }, { signal });
    requireElement<HTMLInputElement>(root, '#tilt-sensitivity').addEventListener('input', (event) => {
      this.settings.patch({ tiltSensitivity: Number((event.currentTarget as HTMLInputElement).value) });
    }, { signal });
    requireElement<HTMLInputElement>(root, '#tilt-dead-zone').addEventListener('input', (event) => {
      this.settings.patch({ tiltDeadZoneDegrees: Number((event.currentTarget as HTMLInputElement).value) });
    }, { signal });
    requireElement<HTMLInputElement>(root, '#screen-shake').addEventListener('input', (event) => {
      this.settings.patch({ screenShake: Number((event.currentTarget as HTMLInputElement).value) });
    }, { signal });
    requireElement<HTMLInputElement>(root, '#stationary-zoom').addEventListener('input', (event) => {
      this.settings.patch({
        stationaryZoomMultiplier: Number((event.currentTarget as HTMLInputElement).value),
      });
    }, { signal });
    requireElement<HTMLInputElement>(root, '#maximum-speed-zoom').addEventListener('input', (event) => {
      this.settings.patch({
        maximumSpeedZoomMultiplier: Number((event.currentTarget as HTMLInputElement).value),
      });
    }, { signal });

    window.addEventListener('keydown', (event) => {
      if (event.code === 'F3') {
        event.preventDefault();
        this.settings.patch({ debugVisible: !this.settings.value.debugVisible });
      }
    }, { signal });
  }

  private updateStrafeHold(): void {
    const direction = Math.max(-1, Math.min(1, [...this.strafeHeld].reduce((sum, value) => sum + value, 0)));
    this.handlers?.onStrafeHold(direction);
  }

  private releaseStrafe(): void {
    this.strafeHeld.clear();
    for (const button of this.shell.querySelectorAll<HTMLButtonElement>('[data-strafe]')) {
      button.toggleAttribute('data-active', false);
    }
    this.handlers?.onStrafeHold(0);
  }

  private applySettingsToControls(value: Readonly<PlayerSettings>): void {
    this.debugPanel.toggleAttribute('data-visible', value.debugVisible);
    requireElement<HTMLInputElement>(this.shell, '#dynamic-zoom').checked = value.dynamicZoom;
    requireElement<HTMLInputElement>(this.shell, '#reduced-motion').checked = value.reducedMotion;
    requireElement<HTMLInputElement>(this.shell, '#invert-pitch').checked = value.invertPitch;
    requireElement<HTMLInputElement>(this.shell, '#tilt-sensitivity').value = String(value.tiltSensitivity);
    requireElement<HTMLInputElement>(this.shell, '#tilt-dead-zone').value = String(value.tiltDeadZoneDegrees);
    requireElement<HTMLInputElement>(this.shell, '#screen-shake').value = String(value.screenShake);
    requireElement<HTMLInputElement>(this.shell, '#stationary-zoom').value = String(value.stationaryZoomMultiplier);
    requireElement<HTMLInputElement>(this.shell, '#maximum-speed-zoom').value = String(value.maximumSpeedZoomMultiplier);
    requireElement(this.shell, '#stationary-zoom-value').textContent =
      `${Math.round(value.stationaryZoomMultiplier * 100)}%`;
    requireElement(this.shell, '#maximum-speed-zoom-value').textContent =
      `${Math.round(value.maximumSpeedZoomMultiplier * 100)}%`;
    this.shell.toggleAttribute('data-reduced-motion', value.reducedMotion);
    this.setMode(value.controlMode);
  }

  private template(): string {
    const stationSprite = assetUrl('./assets/sprites/station_frontier_v2.png');
    const mapPercent = (value: number): number => Math.min(
      100,
      Math.max(0, 50 + value / tuning.sectorHalfExtent * 50),
    );
    const navigationMarkers = navigationDestinations.map((destination) => {
      const style = `left:${mapPercent(destination.position.x).toFixed(2)}%;top:${mapPercent(destination.position.y).toFixed(2)}%`;
      return destination.kind === 'station'
        ? `<button class="navigation-map-marker station-marker" type="button" data-navigation-id="${destination.id}" style="${style}" aria-label="Set navigation for ${destination.name}"><i></i><span>${destination.code}</span></button>`
        : `<button class="navigation-map-marker field-marker" type="button" data-navigation-id="${destination.id}" style="${style}" aria-label="Set navigation for ${destination.name}"><i></i><span>${destination.code}</span></button>`;
    }).join('');
    const stationDestinations = navigationDestinations
      .filter((destination) => destination.kind === 'station')
      .map((destination) => `
        <button class="navigation-destination" type="button" data-navigation-id="${destination.id}">
          <span><small>${destination.code}</small><b>${destination.name}</b></span>
          <em data-navigation-distance="${destination.id}">—</em>
          <p>${destination.description}</p>
          <strong>${destination.services ?? 'BEACON ONLY'}</strong>
        </button>
      `).join('');
    const fieldDestinations = navigationDestinations
      .filter((destination) => destination.kind === 'asteroid-field')
      .map((destination) => `
        <button class="navigation-field-row" type="button" data-navigation-id="${destination.id}">
          <span><small>${destination.code}</small><b>${destination.name}</b></span>
          <em data-navigation-distance="${destination.id}">—</em>
        </button>
      `).join('');
    return `
      <main class="belter-shell" data-testid="belter-shell" data-control-mode="keyboard" data-phase="station">
        <section id="game-canvas-host" class="game-canvas-host" aria-label="Flight view" data-testid="game-canvas-host"></section>

        <div class="hud-layer" aria-live="polite">
          <section class="status-cluster instrument-panel" data-testid="status-cluster">
            <header><span>MULE-01 // SHIP STATUS</span><span id="mode-value">KEYBOARD</span></header>
            <div class="status-row"><span>HULL</span><div class="meter"><i id="hull-bar-fill"></i></div><b id="hull-value">100%</b></div>
            <div class="status-row"><span>FUEL</span><div class="meter meter-fuel"><i id="fuel-bar-fill"></i></div><b id="fuel-value">100%</b></div>
            <div class="status-row"><span>CARGO</span><div class="meter meter-cargo"><i id="cargo-bar-fill"></i></div><b id="cargo-value">0 / 20 t</b></div>
            <div class="status-row"><span>DRONES</span><div class="meter meter-drone"><i id="drone-bar-fill"></i></div><b id="drone-value">2 / 2</b></div>
            <footer><span id="credits-value">120 CR</span><span id="speed-value">0.0 m/s</span></footer>
          </section>

          <section id="target-panel" class="target-panel instrument-panel" data-testid="target-panel">
            <header><span id="target-type">ASTEROID LOCK</span><span id="approach-value">—</span></header>
            <h2 id="target-name">NO TARGET</h2>
            <div class="target-grid">
              <div><span>DIST SURFACE</span><b id="target-distance">—</b></div>
              <div><span>REL SPEED</span><b id="target-relative">—</b></div>
              <div><span>ESTIMATE</span><b id="target-resource">—</b></div>
              <div><span>REMAINING</span><b id="target-yield">—</b></div>
            </div>
            <div class="mining-strip">
              <span id="mining-state">IDLE</span>
              <div class="mining-progress"><i id="mining-progress-fill"></i></div>
              <b id="relative-speed-value">—</b>
            </div>
          </section>

          <div class="objective-chip" data-testid="objective-chip">
            <span>ACTIVE PROCEDURE</span>
            <b id="objective-value">Launch and recover one drone load.</b>
          </div>

          <div id="target-marker" class="target-marker" aria-hidden="true">
            <i id="target-marker-arrow"></i>
            <b id="target-marker-label">0 m</b>
          </div>

          <div id="impact-chip" class="impact-chip" role="status"></div>
          <div id="toast" class="toast" role="status"></div>
          <div class="thrust-readout" id="thrust-value">COAST // ROT 0%</div>

          <div class="quick-actions">
            <button id="quick-calibrate" class="hud-button compact" type="button" hidden>CAL</button>
            <button id="pause-button" class="hud-button" type="button" aria-label="Pause game">PAUSE</button>
          </div>

          <div class="context-actions" data-testid="context-actions">
            <button id="navigation-button" class="action-button secondary-action" type="button">NAV</button>
            <button id="context-button" class="action-button primary-action" type="button">TARGET</button>
          </div>

          <div class="lateral-controls" aria-label="Lateral thrusters" data-testid="lateral-controls">
            <button class="lateral-button" type="button" data-strafe="-1" aria-label="Strafe left"><b>Q</b><span>◀</span></button>
            <button class="lateral-button" type="button" data-strafe="1" aria-label="Strafe right"><span>▶</span><b>E</b></button>
          </div>

          <section id="virtual-joystick" class="virtual-joystick" aria-label="Virtual flight joystick" aria-hidden="true">
            <div id="joystick-pad" class="joystick-pad" data-testid="joystick-pad">
              <div class="joystick-axis horizontal"></div>
              <div class="joystick-axis vertical"></div>
              <div id="joystick-knob" class="joystick-knob"></div>
            </div>
            <span>THRUST / STEER</span>
          </section>

          <aside id="debug-panel" class="debug-panel" aria-label="Simulation debug overlay">
            <header>SIM DEBUG <span>F3</span></header>
            <pre id="debug-content"></pre>
          </aside>
        </div>

        <section id="station-panel" class="station-panel" aria-hidden="true" aria-label="Station interface" data-testid="station-panel">
          <div class="station-shell">
            <header class="station-header">
              <div class="station-ident">
                <span id="station-code">PORT AUTHORITY // CERES RELAY 04</span>
                <h1 id="station-name">MINER'S REST</h1>
                <small id="station-services">CONCOURSE 2 // TRADE • SERVICE • OUTFITTING</small>
              </div>
              <div class="station-vista" aria-hidden="true">
                <div><img src="${stationSprite}" alt="" /></div>
                <span id="station-berth">BERTH 04 // HARD SEAL</span>
              </div>
              <div class="station-balance"><span>AVAILABLE FUNDS</span><b id="station-credits">120 CR</b></div>
            </header>

            <div id="station-loop-status" class="station-loop-status">FIRST RUN // LAUNCH, MINE M-12, RECALL, AND RETURN</div>

            <div class="station-content">
              <section class="station-section market-section">
                <header><span>01</span><div><h2>COMMODITY EXCHANGE</h2><p>Relay spot prices and cargo sale</p></div></header>
                <div class="cargo-summary">
                  <div><span>CARGO ABOARD</span><b id="station-cargo">0.0 / 20 t</b></div>
                  <div><span>SALE VALUE</span><b id="station-sale-value">0 CR</b></div>
                </div>
                <div id="market-resource-rows" class="market-resource-rows"></div>
                <button id="sell-all-button" class="station-primary-button" type="button" disabled>SELL ALL CARGO</button>
              </section>

              <section class="station-section service-section">
                <header><span>02</span><div><h2>HANGAR SERVICES</h2><p>Mule-01 inspection and turnaround</p></div></header>
                <div id="station-ship-preview" class="station-ship-preview"></div>
                <div id="station-ship-stats" class="station-ship-stats"></div>
                <button id="service-button" class="station-secondary-button" type="button">SERVICE HULL / FUEL / DRONES</button>
              </section>

              <section class="station-section shipyard-section">
                <header><span>03</span><div><h2>OUTFITTERS</h2><p>Internal ship systems and visible hardpoint equipment</p></div></header>
                <div id="module-list" class="module-list"></div>
              </section>
            </div>

            <footer class="station-footer">
              <div>
                <span>${GAME_TITLE.toUpperCase()}</span>
                <small>${GAME_VERSION} // CAREER AUTOSAVES AFTER STATION TRANSACTIONS</small>
              </div>
              <button id="launch-button" class="launch-button" type="button">LAUNCH EXPEDITION</button>
            </footer>
          </div>
        </section>

        <section id="navigation-panel" class="navigation-panel" aria-hidden="true" aria-label="Sector navigation map" data-testid="navigation-panel">
          <div class="navigation-shell">
            <header class="navigation-header">
              <div><span id="navigation-system-label">MULE-01 // STANDARD NAVIGATION</span><h1>LOCAL SECTOR MAP</h1></div>
              <button id="navigation-close" class="navigation-close" type="button">CLOSE</button>
            </header>
            <div class="navigation-content">
              <div class="navigation-map" aria-label="Mapped sector objects">
                <div class="navigation-map-grid"></div>
                <div class="navigation-belt-band" aria-hidden="true"></div>
                <div id="navigation-ship-marker" class="navigation-ship-marker"><i></i><span>MULE-01</span></div>
                <button id="navigation-trader-marker" class="navigation-trader-marker" type="button"><i></i><span>FT-LARK</span></button>
                <div id="navigation-asteroid-markers"></div>
                ${navigationMarkers}
                <div class="navigation-map-scale"><span>−2.4 KM</span><b>LOCAL GRID</b><span>+2.4 KM</span></div>
              </div>
              <aside class="navigation-directory">
                <div id="navigation-status" class="navigation-status">NO NAVIGATION DESTINATION SELECTED</div>
                <section>
                  <header><span>STATIONS</span><small>SELECT FOR ROUTE + DOCKING</small></header>
                  <div class="navigation-destinations">${stationDestinations}</div>
                </section>
                <section>
                  <header><span>ASTEROID FIELDS</span><small>SELECT FOR ROUTE + ARRIVAL</small></header>
                  <div class="navigation-fields">${fieldDestinations}</div>
                </section>
                <section>
                  <header><span>TRACKABLE CONTACTS</span><small>SHIPS + VERY-LARGE BODIES</small></header>
                  <div id="navigation-contacts" class="navigation-contacts"></div>
                </section>
                <button id="navigation-autopilot" class="navigation-autopilot" type="button" disabled>WAYFINDER REQUIRED</button>
                <p id="navigation-warning" class="navigation-warning">NAVIGATION BEACONS AND DIRECTION POINTERS ARE STANDARD. INSTALL WAYFINDER FOR AUTOPILOT.</p>
              </aside>
            </div>
          </div>
        </section>

        <section id="pause-panel" class="pause-panel" aria-hidden="true" aria-label="Pause and settings">
          <div class="pause-card">
            <header class="pause-header">
              <div><span>${GAME_TITLE}</span><small>${GAME_VERSION}</small></div>
              <strong>FLIGHT PAUSED</strong>
            </header>

            <div class="settings-grid">
              <section>
                <h2>CONTROL ADAPTER</h2>
                <div class="segmented-control" role="group" aria-label="Control mode">
                  <button type="button" data-control-mode="keyboard">KEYBOARD</button>
                  <button type="button" data-control-mode="joystick">JOYSTICK</button>
                  <button type="button" data-control-mode="tilt">PHONE TILT</button>
                </div>
                <p id="tilt-status-value" class="sensor-status">UNKNOWN</p>
                <button id="calibrate-tilt" class="secondary-button" type="button">CALIBRATE NEUTRAL</button>
              </section>

              <section>
                <h2>TILT TUNING</h2>
                <label class="range-setting"><span>SENSITIVITY</span><input id="tilt-sensitivity" type="range" min="0.55" max="1.6" step="0.05" value="1" /></label>
                <label class="range-setting"><span>DEAD ZONE</span><input id="tilt-dead-zone" type="range" min="1" max="8" step="0.5" value="3" /></label>
                <label class="toggle-setting"><input id="invert-pitch" type="checkbox" /><span>INVERT PITCH</span></label>
              </section>

              <section>
                <h2>PRESENTATION</h2>
                <label class="toggle-setting"><input id="dynamic-zoom" type="checkbox" checked /><span>DYNAMIC ZOOM</span></label>
                <label class="range-setting zoom-setting">
                  <span>0 M/S ZOOM</span>
                  <input id="stationary-zoom" type="range" min="0.3" max="1.3" step="0.02" value="1" />
                  <b id="stationary-zoom-value">100%</b>
                </label>
                <label class="range-setting zoom-setting">
                  <span>150 M/S ZOOM</span>
                  <input id="maximum-speed-zoom" type="range" min="0.22" max="1.3" step="0.02" value="0.86" />
                  <b id="maximum-speed-zoom-value">86%</b>
                </label>
                <label class="range-setting"><span>SCREEN SHAKE</span><input id="screen-shake" type="range" min="0" max="1" step="0.05" value="0.65" /></label>
                <label class="toggle-setting"><input id="reduced-motion" type="checkbox" /><span>REDUCED UI MOTION</span></label>
              </section>

              <section>
                <h2>LOCAL DATA</h2>
                <p>Reset the current expedition or clear all saved progression.</p>
                <div class="tool-row">
                  <button id="reset-expedition" class="secondary-button" type="button">RESET EXPEDITION</button>
                  <button id="reset-career" class="secondary-button danger" type="button">RESET CAREER</button>
                </div>
              </section>
            </div>

            <footer class="pause-footer">
              <p>Releasing thrust stops acceleration. Existing velocity remains.</p>
              <button id="resume-button" class="primary-button" type="button">RESUME FLIGHT</button>
            </footer>
          </div>
        </section>
      </main>
    `;
  }
}
