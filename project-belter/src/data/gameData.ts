export type ResourceType = 'water' | 'industrial' | 'rare';
export type AsteroidResourceType = ResourceType | 'none';

export interface ResourceDefinition {
  id: ResourceType;
  label: string;
  shortLabel: string;
  unitPrice: number;
}

export const resourceDefinitions: Record<ResourceType, ResourceDefinition> = {
  water: { id: 'water', label: 'Water ice', shortLabel: 'H₂O', unitPrice: 18 },
  industrial: { id: 'industrial', label: 'Industrial metals', shortLabel: 'Fe/Ni', unitPrice: 42 },
  rare: { id: 'rare', label: 'Rare metals', shortLabel: 'PGM', unitPrice: 120 },
};

export type ResourceTier = 'trace' | 'standard' | 'rich' | 'exceptional';

export interface ResourceTierDefinition {
  id: ResourceTier;
  label: string;
  yieldMultiplier: number;
  glintScale: number;
}

export const resourceTierDefinitions: Record<ResourceTier, ResourceTierDefinition> = {
  trace: { id: 'trace', label: 'Trace', yieldMultiplier: 0.42, glintScale: 0.72 },
  standard: { id: 'standard', label: 'Standard', yieldMultiplier: 0.78, glintScale: 0.92 },
  rich: { id: 'rich', label: 'Rich', yieldMultiplier: 1.18, glintScale: 1.16 },
  exceptional: { id: 'exceptional', label: 'Exceptional', yieldMultiplier: 1.62, glintScale: 1.42 },
};

export type ModuleId =
  | 'mining-drone'
  | 'engine-kestrel'
  | 'retro-brace'
  | 'cargo-saddles'
  | 'flight-assist';

export interface ModuleDefinition {
  id: ModuleId;
  displayName: string;
  category: 'drone' | 'engine' | 'retro' | 'cargo' | 'avionics';
  mounting: 'hardpoint' | 'internal';
  description: string;
  purchasePrice: number;
  massAdd: number;
  forwardThrustMultiplier: number;
  reverseThrustMultiplier: number;
  rotationalAccelerationMultiplier: number;
  fuelUseMultiplier: number;
  cargoCapacityAdd: number;
  spriteKey: string;
}

export const moduleDefinitions: Record<ModuleId, ModuleDefinition> = {
  'mining-drone': {
    id: 'mining-drone',
    displayName: 'Prospector mining drone',
    category: 'drone',
    mounting: 'hardpoint',
    description: 'Deploys, mines, unloads through the central cargo bay, and returns to its assigned hardpoint.',
    purchasePrice: 180,
    massAdd: 0.8,
    forwardThrustMultiplier: 1,
    reverseThrustMultiplier: 1,
    rotationalAccelerationMultiplier: 0.98,
    fuelUseMultiplier: 1,
    cargoCapacityAdd: 0,
    spriteKey: 'drone.miner.v3',
  },
  'engine-kestrel': {
    id: 'engine-kestrel',
    displayName: 'Kestrel drive pods',
    category: 'engine',
    mounting: 'hardpoint',
    description: 'Hardpoint drive booster: +35% main thrust, +18% engine fuel use, +1.5 t mass.',
    purchasePrice: 300,
    massAdd: 1.5,
    forwardThrustMultiplier: 1.35,
    reverseThrustMultiplier: 1,
    rotationalAccelerationMultiplier: 1,
    fuelUseMultiplier: 1.18,
    cargoCapacityAdd: 0,
    spriteKey: 'module.engine.v2',
  },
  'retro-brace': {
    id: 'retro-brace',
    displayName: 'Braced retro pack',
    category: 'retro',
    mounting: 'hardpoint',
    description: 'Hardpoint maneuver pack: +50% reverse thrust, +8% rotational response, +1.2 t mass.',
    purchasePrice: 240,
    massAdd: 1.2,
    forwardThrustMultiplier: 1,
    reverseThrustMultiplier: 1.5,
    rotationalAccelerationMultiplier: 1.08,
    fuelUseMultiplier: 1.05,
    cargoCapacityAdd: 0,
    spriteKey: 'module.retro.v2',
  },
  'cargo-saddles': {
    id: 'cargo-saddles',
    displayName: 'External cargo saddles',
    category: 'cargo',
    mounting: 'hardpoint',
    description: 'Hardpoint cargo relay: +12 t cargo capacity and +2.8 t mass.',
    purchasePrice: 280,
    massAdd: 2.8,
    forwardThrustMultiplier: 1,
    reverseThrustMultiplier: 1,
    rotationalAccelerationMultiplier: 0.94,
    fuelUseMultiplier: 1,
    cargoCapacityAdd: 12,
    spriteKey: 'module.cargo.v2',
  },
  'flight-assist': {
    id: 'flight-assist',
    displayName: 'Wayfinder autopilot',
    category: 'avionics',
    mounting: 'internal',
    description: 'Internal navigation computer: follows mapped routes and closes safely with selected asteroids. Uses no hardpoint.',
    purchasePrice: 220,
    massAdd: 0,
    forwardThrustMultiplier: 1,
    reverseThrustMultiplier: 1,
    rotationalAccelerationMultiplier: 1,
    fuelUseMultiplier: 1,
    cargoCapacityAdd: 0,
    spriteKey: 'module.assist.v2',
  },
};

export const allModuleIds = Object.keys(moduleDefinitions) as ModuleId[];

export const isModuleId = (value: unknown): value is ModuleId =>
  typeof value === 'string' && allModuleIds.includes(value as ModuleId);

export const isHardpointModule = (moduleId: ModuleId): boolean =>
  moduleDefinitions[moduleId].mounting === 'hardpoint';
