export type NavigationDestinationKind = 'station' | 'asteroid-field' | 'trader' | 'asteroid';

export interface NavigationDestination {
  id: string;
  kind: NavigationDestinationKind;
  name: string;
  code: string;
  position: { x: number; y: number };
  description: string;
  services?: string;
}

export const navigationDestinations: readonly NavigationDestination[] = [
  {
    id: 'ceres-relay',
    kind: 'station',
    name: "Miner's Rest",
    code: 'CERES RELAY 04',
    position: { x: 900, y: 1750 },
    description: 'Lower-sector berth and local commodity exchange.',
    services: 'TRADE // SERVICE // OUTFITTING',
  },
  {
    id: 'pallas-gate',
    kind: 'station',
    name: 'Pallas Gate',
    code: 'PALLAS TRANSFER 02',
    position: { x: -1700, y: -1500 },
    description: 'Upper-left transfer hub with fuel, service, and cargo handling.',
    services: 'TRANSFER // FUEL',
  },
  {
    id: 'kestrel-field',
    kind: 'asteroid-field',
    name: 'Kestrel Field',
    code: 'BELT GRID K-12',
    position: { x: 0, y: 0 },
    description: 'Broad, lower-density centre of the diagonal belt.',
  },
  {
    id: 'helix-belt',
    kind: 'asteroid-field',
    name: 'Helix Belt',
    code: 'BELT GRID H-08',
    position: { x: -1500, y: 1500 },
    description: 'Violent lower-left lobe with larger, richer bodies.',
  },
  {
    id: 'eos-drift',
    kind: 'asteroid-field',
    name: 'Eos Drift',
    code: 'BELT GRID E-19',
    position: { x: 1500, y: -1500 },
    description: 'Violent upper-right lobe with larger, richer bodies.',
  },
];

export const getNavigationDestination = (id: string): NavigationDestination | null =>
  navigationDestinations.find((destination) => destination.id === id) ?? null;
