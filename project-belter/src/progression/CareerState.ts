import {
  allModuleIds,
  isHardpointModule,
  isModuleId,
  moduleDefinitions,
  resourceDefinitions,
  type ModuleId,
  type ResourceType,
} from '../data/gameData';
import { hardpointIds, type HardpointId } from '../game/simulation/components';

export const CAREER_SAVE_VERSION = 3 as const;

export interface CareerStats {
  expeditionsCompleted: number;
  resourcesSold: number;
  creditsEarned: number;
  upgradesPurchased: number;
}

export interface CareerState {
  version: typeof CAREER_SAVE_VERSION;
  credits: number;
  ownedModules: ModuleId[];
  installedModules: ModuleId[];
  hardpointLoadout: Record<HardpointId, ModuleId | null>;
  hardpointCondition: Record<HardpointId, number>;
  stats: CareerStats;
  tutorialComplete: boolean;
  lastSavedAt: string;
}

export interface CargoManifest {
  water: number;
  industrial: number;
  rare: number;
}

export const createEmptyCargo = (): CargoManifest => ({ water: 0, industrial: 0, rare: 0 });

export const createDefaultCareer = (): CareerState => ({
  version: CAREER_SAVE_VERSION,
  credits: 120,
  ownedModules: ['mining-drone'],
  installedModules: ['mining-drone'],
  hardpointLoadout: {
    port: null,
    starboard: null,
    ventral: 'mining-drone',
  },
  hardpointCondition: {
    port: 100,
    starboard: 100,
    ventral: 100,
  },
  stats: {
    expeditionsCompleted: 0,
    resourcesSold: 0,
    creditsEarned: 0,
    upgradesPurchased: 0,
  },
  tutorialComplete: false,
  lastSavedAt: new Date(0).toISOString(),
});

const finiteNonNegative = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
};

export const getOwnedModuleCount = (
  career: Pick<CareerState, 'ownedModules'>,
  moduleId: ModuleId,
): number => career.ownedModules.filter((ownedId) => ownedId === moduleId).length;

export const getMountedModuleCount = (
  career: Pick<CareerState, 'hardpointLoadout'>,
  moduleId: ModuleId,
): number => hardpointIds.filter((hardpoint) => career.hardpointLoadout[hardpoint] === moduleId).length;

export const normalizeCareer = (candidate: Partial<CareerState> | null | undefined): CareerState => {
  const defaults = createDefaultCareer();
  const owned = Array.isArray(candidate?.ownedModules)
    ? candidate.ownedModules.filter(isModuleId)
    : defaults.ownedModules;
  if (!owned.includes('mining-drone')) {
    owned.unshift('mining-drone');
  }
  const installed = Array.isArray(candidate?.installedModules)
    ? candidate.installedModules.filter((id): id is ModuleId => isModuleId(id) && owned.includes(id))
    : defaults.installedModules;
  const loadoutCandidate = candidate?.hardpointLoadout;
  const hardpointLoadout: Record<HardpointId, ModuleId | null> = {
    port: null,
    starboard: null,
    ventral: null,
  };
  const used = new Map<ModuleId, number>();
  if (loadoutCandidate !== undefined) {
    for (const hardpoint of hardpointIds) {
      const moduleId = loadoutCandidate[hardpoint];
      const available = moduleId !== null && isModuleId(moduleId)
        ? owned.filter((ownedId) => ownedId === moduleId).length
        : 0;
      const mounted = moduleId !== null && isModuleId(moduleId) ? used.get(moduleId) ?? 0 : 0;
      if (moduleId !== null && isModuleId(moduleId) && isHardpointModule(moduleId) && mounted < available) {
        hardpointLoadout[hardpoint] = moduleId;
        used.set(moduleId, mounted + 1);
      } else if (moduleId === null) {
        hardpointLoadout[hardpoint] = null;
      }
    }
  } else {
    hardpointLoadout.ventral = 'mining-drone';
    used.set('mining-drone', 1);
    for (const moduleId of installed) {
      if (!isHardpointModule(moduleId)) {
        continue;
      }
      const mounted = used.get(moduleId) ?? 0;
      const available = owned.filter((ownedId) => ownedId === moduleId).length;
      if (moduleId === 'mining-drone' && mounted > 0 && available === 1) {
        continue;
      }
      if (mounted >= available) {
        continue;
      }
      const empty = hardpointIds.find((hardpoint) => hardpointLoadout[hardpoint] === null);
      if (empty !== undefined) {
        hardpointLoadout[empty] = moduleId;
        used.set(moduleId, mounted + 1);
      }
    }
  }
  const conditionCandidate = candidate?.hardpointCondition;
  const hardpointCondition: Record<HardpointId, number> = {
    port: finiteNonNegative(conditionCandidate?.port, 100),
    starboard: finiteNonNegative(conditionCandidate?.starboard, 100),
    ventral: finiteNonNegative(conditionCandidate?.ventral, 100),
  };
  for (const hardpoint of hardpointIds) {
    hardpointCondition[hardpoint] = Math.min(100, hardpointCondition[hardpoint]);
  }
  const mountedModules = hardpointIds
    .map((hardpoint) => hardpointLoadout[hardpoint])
    .filter((moduleId): moduleId is ModuleId => moduleId !== null);
  const internalModules = allModuleIds.filter(
    (moduleId) => !isHardpointModule(moduleId) && owned.includes(moduleId),
  );
  const normalizedInstalled = [...mountedModules, ...internalModules];
  const stats = candidate?.stats;

  return {
    version: CAREER_SAVE_VERSION,
    credits: finiteNonNegative(candidate?.credits, defaults.credits),
    ownedModules: [...owned],
    installedModules: normalizedInstalled,
    hardpointLoadout,
    hardpointCondition,
    stats: {
      expeditionsCompleted: Math.floor(finiteNonNegative(stats?.expeditionsCompleted)),
      resourcesSold: finiteNonNegative(stats?.resourcesSold),
      creditsEarned: finiteNonNegative(stats?.creditsEarned),
      upgradesPurchased: Math.floor(finiteNonNegative(stats?.upgradesPurchased)),
    },
    tutorialComplete: Boolean(candidate?.tutorialComplete),
    lastSavedAt: typeof candidate?.lastSavedAt === 'string' ? candidate.lastSavedAt : defaults.lastSavedAt,
  };
};

export const calculateCargoMass = (cargo: Readonly<CargoManifest>): number =>
  cargo.water + cargo.industrial + cargo.rare;

export const calculateCargoValue = (cargo: Readonly<CargoManifest>): number =>
  (Object.keys(resourceDefinitions) as ResourceType[]).reduce(
    (total, resource) => total + cargo[resource] * resourceDefinitions[resource].unitPrice,
    0,
  );

export interface SaleResult {
  revenue: number;
  massSold: number;
}

export const sellCargoIntoCareer = (
  career: CareerState,
  cargo: CargoManifest,
): SaleResult => {
  const revenue = calculateCargoValue(cargo);
  const massSold = calculateCargoMass(cargo);
  career.credits += revenue;
  career.stats.resourcesSold += massSold;
  career.stats.creditsEarned += revenue;
  cargo.water = 0;
  cargo.industrial = 0;
  cargo.rare = 0;
  return { revenue, massSold };
};

export type PurchaseFailure = 'insufficient-credits' | 'unknown-module' | 'already-owned';
export type PurchaseResult = { ok: true; definitionId: ModuleId } | { ok: false; reason: PurchaseFailure };

export const purchaseAndInstallModule = (career: CareerState, moduleId: string): PurchaseResult => {
  if (!isModuleId(moduleId)) {
    return { ok: false, reason: 'unknown-module' };
  }
  const definition = moduleDefinitions[moduleId];
  if (definition.mounting === 'internal' && career.ownedModules.includes(moduleId)) {
    return { ok: false, reason: 'already-owned' };
  }
  if (career.credits < definition.purchasePrice) {
    return { ok: false, reason: 'insufficient-credits' };
  }
  career.credits -= definition.purchasePrice;
  career.ownedModules.push(moduleId);
  if (definition.mounting === 'hardpoint') {
    const emptyHardpoint = hardpointIds.find((hardpoint) => career.hardpointLoadout[hardpoint] === null);
    if (emptyHardpoint !== undefined) {
      career.hardpointLoadout[emptyHardpoint] = moduleId;
      career.hardpointCondition[emptyHardpoint] = 100;
    }
  }
  syncInstalledModules(career);
  career.stats.upgradesPurchased += 1;
  return { ok: true, definitionId: moduleId };
};

export const uninstallModule = (career: CareerState, moduleId: ModuleId): void => {
  for (const hardpoint of hardpointIds) {
    if (career.hardpointLoadout[hardpoint] === moduleId) {
      career.hardpointLoadout[hardpoint] = null;
      career.hardpointCondition[hardpoint] = 100;
    }
  }
  syncInstalledModules(career);
};

export const unmountHardpoint = (career: CareerState, hardpoint: HardpointId): void => {
  career.hardpointLoadout[hardpoint] = null;
  career.hardpointCondition[hardpoint] = 100;
  syncInstalledModules(career);
};

export const getAvailableModuleDefinitions = () => allModuleIds.map((id) => moduleDefinitions[id]);

export const mountModule = (
  career: CareerState,
  moduleId: ModuleId,
  hardpoint: HardpointId,
): boolean => {
  if (!isHardpointModule(moduleId)) {
    return false;
  }
  const ownedCount = getOwnedModuleCount(career, moduleId);
  if (ownedCount === 0) {
    return false;
  }
  if (career.hardpointLoadout[hardpoint] === moduleId) {
    return true;
  }
  const mountedHardpoints = hardpointIds.filter(
    (candidate) => career.hardpointLoadout[candidate] === moduleId,
  );
  const displaced = career.hardpointLoadout[hardpoint];
  if (mountedHardpoints.length < ownedCount) {
    career.hardpointLoadout[hardpoint] = moduleId;
    career.hardpointCondition[hardpoint] = 100;
    syncInstalledModules(career);
    return true;
  }
  const previousHardpoint = mountedHardpoints[0];
  if (previousHardpoint === undefined) {
    return false;
  }
  const movingCondition = career.hardpointCondition[previousHardpoint];
  const displacedCondition = career.hardpointCondition[hardpoint];
  career.hardpointLoadout[previousHardpoint] = displaced;
  career.hardpointCondition[previousHardpoint] = displaced === null ? 100 : displacedCondition;
  career.hardpointLoadout[hardpoint] = moduleId;
  career.hardpointCondition[hardpoint] = movingCondition;
  syncInstalledModules(career);
  return true;
};

export const repairHardpointEquipment = (career: CareerState): void => {
  for (const hardpoint of hardpointIds) {
    career.hardpointCondition[hardpoint] = 100;
  }
};

const syncInstalledModules = (career: CareerState): void => {
  const mountedModules = hardpointIds
    .map((hardpoint) => career.hardpointLoadout[hardpoint])
    .filter((moduleId): moduleId is ModuleId => moduleId !== null);
  const internalModules = allModuleIds.filter(
    (moduleId) => !isHardpointModule(moduleId) && career.ownedModules.includes(moduleId),
  );
  career.installedModules = [...mountedModules, ...internalModules];
};
