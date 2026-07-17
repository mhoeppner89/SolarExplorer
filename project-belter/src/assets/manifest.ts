export const assetManifest = {
  ship: {
    base: 'ship.hauler.v1',
    moduleEngine: 'module.engine.v2',
    moduleRetro: 'module.retro.v2',
    moduleCargo: 'module.cargo.v2',
    moduleAssist: 'module.assist.v2',
  },
  station: 'station.frontier.v2',
  asteroids: {
    rocky: ['asteroid.rocky.0.v1', 'asteroid.rocky.1.v1', 'asteroid.rocky.2.v1', 'asteroid.rocky.3.v1'],
    carbonaceous: ['asteroid.carbon.0.v3', 'asteroid.carbon.1.v3', 'asteroid.carbon.2.v3', 'asteroid.carbon.3.v3'],
    icy: ['asteroid.icy.0.v3', 'asteroid.icy.1.v3', 'asteroid.icy.2.v3', 'asteroid.icy.3.v3'],
    metallic: ['asteroid.metallic.0.v3', 'asteroid.metallic.1.v3', 'asteroid.metallic.2.v3', 'asteroid.metallic.3.v3'],
  },
  colossalAsteroids: {
    rocky: ['asteroid.rocky.0.colossal.v1', 'asteroid.rocky.1.colossal.v1', 'asteroid.rocky.2.colossal.v1', 'asteroid.rocky.3.colossal.v1'],
    carbonaceous: ['asteroid.carbon.0.colossal.v1', 'asteroid.carbon.1.colossal.v1', 'asteroid.carbon.2.colossal.v1', 'asteroid.carbon.3.colossal.v1'],
    icy: ['asteroid.icy.0.colossal.v1', 'asteroid.icy.1.colossal.v1', 'asteroid.icy.2.colossal.v1', 'asteroid.icy.3.colossal.v1'],
    metallic: ['asteroid.metallic.0.colossal.v1', 'asteroid.metallic.1.colossal.v1', 'asteroid.metallic.2.colossal.v1', 'asteroid.metallic.3.colossal.v1'],
  },
  drones: ['drone.miner.v3'],
  debris: ['debris.fragment.v2'],
} as const;

export type AssetManifest = typeof assetManifest;
