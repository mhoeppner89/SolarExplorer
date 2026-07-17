import type { CareerState } from '../progression/CareerState';
import type { FlightActionState, InputMode } from '../game/input/InputActions';
import type { CameraTelemetry } from '../game/rendering/CameraRig';
import type { SimulationDebugSnapshot } from '../game/simulation/GameSimulation';

export interface BelterDebugBridge {
  getSnapshot: () => SimulationDebugSnapshot;
  getCareer: () => CareerState;
  getCameraTelemetry: () => CameraTelemetry;
  getInputMode: () => InputMode;
  isPaused: () => boolean;
  isStationOpen: () => boolean;
  isNavigationOpen: () => boolean;
  openNavigation: () => void;
  selectNavigationDestination: (destinationId: string) => boolean;
  selectNavigationEntity: (kind: 'trader' | 'asteroid', entityId: number) => boolean;
  toggleAutopilot: () => boolean;
  setShipPosition: (position: { x: number; y: number }) => void;
  setShipVelocity: (velocity: { x: number; y: number }) => void;
  setShipFuel: (fuel: number) => void;
  setFlightAction: (action: keyof FlightActionState, value: number | boolean) => void;
  setCargoMass: (mass: number) => void;
  resetSimulation: () => void;
  launch: () => boolean;
  getTutorialTarget: () => { id: number; position: { x: number; y: number } } | null;
  selectTutorialTarget: () => boolean;
  teleportNearTarget: (surfaceDistance?: number) => void;
  recallDrones: () => void;
  prepareDocking: () => void;
  advanceSimulation: (seconds: number, actions?: Partial<FlightActionState>) => void;
  sellAllCargo: () => number;
  buyModule: (moduleId: string) => boolean;
  destroy: () => void;
}

declare global {
  interface Window {
    __BELTER_DEBUG__?: BelterDebugBridge;
    __BELTER_ASSET_DATA__?: Record<string, string>;
    render_game_to_text?: () => string;
    advanceTime?: (milliseconds: number) => void;
  }
}
