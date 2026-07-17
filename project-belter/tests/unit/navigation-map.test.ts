import { describe, expect, it } from 'vitest';
import { getNavigationDestination, navigationDestinations } from '../../src/data/navigationData';
import { neutralFlightActions } from '../../src/game/input/InputActions';
import { GameSimulation } from '../../src/game/simulation/GameSimulation';
import { distance } from '../../src/game/simulation/Vector2';
import { AutopilotSystem } from '../../src/game/simulation/systems/AutopilotSystem';
import { tuning } from '../../src/game/config/tuning';

const dt = 1 / tuning.simulationHz;

describe('sector navigation and autopilot', () => {
  it('provides navigation beacons without engaging unpurchased autopilot', () => {
    const simulation = new GameSimulation();
    simulation.launch();
    const station = getNavigationDestination('pallas-gate');
    expect(station).not.toBeNull();
    if (station === null) {
      return;
    }

    expect(simulation.setNavigationBeacon(station)).toBe(true);
    const snapshot = simulation.getDebugSnapshot();
    expect(snapshot.navigationBeacon?.id).toBe('pallas-gate');
    expect(snapshot.autopilotAvailable).toBe(false);
    expect(snapshot.autopilot.enabled).toBe(false);
  });

  it('maps two physical stations and three asteroid-field nav points', () => {
    expect(navigationDestinations.filter((destination) => destination.kind === 'station')).toHaveLength(2);
    expect(navigationDestinations.filter((destination) => destination.kind === 'asteroid-field')).toHaveLength(3);

    const simulation = new GameSimulation();
    expect(simulation.entities.stations.size).toBe(2);
    expect([...simulation.entities.stations.values()].map((station) => station.destinationId))
      .toEqual(expect.arrayContaining(['ceres-relay', 'pallas-gate']));
  });

  it('plots guide routes to trackable very-large asteroids without starting autopilot', () => {
    const simulation = new GameSimulation(undefined, 84_221, ['flight-assist']);
    simulation.launch();
    const massif = simulation.getDebugSnapshot().trackableAsteroids[0];
    expect(massif).toBeDefined();
    if (massif === undefined) {
      return;
    }

    expect(simulation.setEntityNavigationBeacon('asteroid', massif.id)).toBe(true);
    const snapshot = simulation.getDebugSnapshot();
    expect(snapshot.navigationBeacon?.kind).toBe('asteroid');
    expect(snapshot.target?.kind).toBe('asteroid');
    expect(snapshot.autopilot.path.length).toBeGreaterThan(0);
    expect(snapshot.autopilot.enabled).toBe(false);
  });

  it('plans a smoothed detour around an inflated moving-object envelope', () => {
    const system = new AutopilotSystem(tuning);
    const start = { x: -420, y: 0 };
    const goal = { x: 420, y: 0 };
    const obstacles = [{
      id: 1,
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 3 },
      radius: 120,
    }];
    const path = system.plan(start, goal, obstacles);

    expect(path.length).toBeGreaterThan(1);
    let previous = start;
    for (const waypoint of path) {
      expect(system.isSegmentClear(previous, waypoint, obstacles)).toBe(true);
      previous = waypoint;
    }
    expect(path.at(-1)).toEqual(goal);
  });

  it('accepts a dense-field corridor with 20 metres of base surface clearance', () => {
    const system = new AutopilotSystem(tuning);
    const start = { x: -400, y: 0 };
    const goal = { x: 400, y: 0 };
    const obstacles = [
      { id: 1, position: { x: 0, y: -164 }, velocity: { x: 0, y: 0 }, radius: 100 },
      { id: 2, position: { x: 0, y: 164 }, velocity: { x: 0, y: 0 }, radius: 100 },
    ];

    const path = system.plan(start, goal, obstacles);

    expect(tuning.navigation.autopilotSafetyMargin).toBe(20);
    expect(system.isPathClear(start, path, obstacles)).toBe(true);
    expect(path.every((waypoint) => Math.abs(waypoint.y) < 0.001)).toBe(true);
  });

  it('keeps every displayed segment clear around the very-large Atlas-style blocker', () => {
    const system = new AutopilotSystem(tuning);
    const start = { x: 1_050, y: -900 };
    const goal = { x: 0, y: -5 };
    const obstacles = [{
      id: 1,
      position: { x: 360, y: -680 },
      velocity: { x: 0, y: 0 },
      radius: 300,
    }];
    const path = system.plan(start, goal, obstacles);

    expect(path.length).toBeGreaterThanOrEqual(3);
    expect(system.isPathClear(start, path, obstacles)).toBe(true);
    expect(path.at(-1)).toEqual(goal);
    for (let index = 1; index < path.length; index += 1) {
      expect(distance(path[index - 1]!, path[index]!)).toBeLessThanOrEqual(
        tuning.navigation.autopilotMaxShortcutDistance + 0.1,
      );
    }
  });

  it('replans when a later displayed leg becomes obstructed', () => {
    const system = new AutopilotSystem(tuning);
    const start = { x: -600, y: 0 };
    const goal = { x: 600, y: 0 };
    const primary = {
      id: 1,
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      radius: 120,
    };
    const initial = system.update(start, goal, [primary], 0);
    expect(initial.path.length).toBeGreaterThanOrEqual(3);
    const finalLegStart = initial.path.at(-2);
    const finalLegEnd = initial.path.at(-1);
    expect(finalLegStart).toBeDefined();
    expect(finalLegEnd).toBeDefined();
    if (finalLegStart === undefined || finalLegEnd === undefined) {
      return;
    }
    const laterBlocker = {
      id: 2,
      position: {
        x: (finalLegStart.x + finalLegEnd.x) / 2,
        y: (finalLegStart.y + finalLegEnd.y) / 2,
      },
      velocity: { x: 0, y: 0 },
      radius: 34,
    };

    const replanned = system.update(start, goal, [primary, laterBlocker], dt);

    expect(replanned.path).not.toEqual(initial.path);
    expect(system.isPathClear(start, replanned.path, [primary, laterBlocker])).toBe(true);
  });

  it('keeps a clear route stable while the ship closely follows it', () => {
    const system = new AutopilotSystem(tuning);
    const start = { x: 0, y: 0 };
    const goal = { x: 0, y: -1_000 };
    const initial = system.update(start, goal, [], 0);

    const stable = system.update({ x: 0, y: -12 }, goal, [], tuning.navigation.autopilotReplanSeconds + 0.1);

    expect(stable.path).toEqual(initial.path);
  });

  it('retires manual-guide waypoints as soon as the ship passes their plane', () => {
    const system = new AutopilotSystem(tuning);
    const start = { x: 0, y: 0 };
    const goal = { x: 1_000, y: 0 };
    const initial = system.update(start, goal, [], 0);
    expect(initial.path.length).toBeGreaterThanOrEqual(4);
    const firstWaypoint = initial.path[0];
    expect(firstWaypoint).toBeDefined();
    if (firstWaypoint === undefined) {
      return;
    }

    const progressed = system.update(
      { x: firstWaypoint.x + 12, y: 90 },
      goal,
      [],
      dt,
    );

    expect(progressed.path.length).toBeLessThan(initial.path.length);
    expect(progressed.path[0]).not.toEqual(firstWaypoint);
  });

  it('plots a station route, engages autopilot explicitly, and allows direct override', () => {
    const simulation = new GameSimulation(undefined, 84_221, ['flight-assist']);
    simulation.launch();
    const station = getNavigationDestination('pallas-gate');
    expect(station).not.toBeNull();
    if (station === null) {
      return;
    }

    expect(simulation.setNavigationBeacon(station)).toBe(true);
    let snapshot = simulation.getDebugSnapshot();
    expect(snapshot.navigationBeacon?.id).toBe('pallas-gate');
    expect(snapshot.autopilot.enabled).toBe(false);
    expect(snapshot.autopilot.path.length).toBeGreaterThan(0);
    expect(simulation.toggleAutopilot()).toBe(true);
    snapshot = simulation.getDebugSnapshot();
    expect(snapshot.autopilot.enabled).toBe(true);
    expect(snapshot.target?.kind).toBe('station');
    expect(snapshot.assistEnabled).toBe(false);

    simulation.step(dt, { ...neutralFlightActions(), thrustForward: 1 });
    snapshot = simulation.getDebugSnapshot();
    expect(snapshot.autopilot.enabled).toBe(false);
    expect(snapshot.navigationBeacon?.id).toBe('pallas-gate');
  });

  it('flies to an asteroid-field nav point and hands control back at arrival', () => {
    const simulation = new GameSimulation(undefined, 18_744, ['flight-assist']);
    simulation.launch();
    simulation.clearAsteroids();
    const field = getNavigationDestination('kestrel-field');
    expect(field).not.toBeNull();
    if (field === null) {
      return;
    }

    expect(simulation.setNavigationBeacon(field)).toBe(true);
    expect(simulation.toggleAutopilot()).toBe(true);
    for (let index = 0; index < tuning.simulationHz * 80; index += 1) {
      simulation.step(dt, neutralFlightActions());
      if (!simulation.getDebugSnapshot().autopilot.enabled) {
        break;
      }
    }

    const snapshot = simulation.getDebugSnapshot();
    expect(snapshot.autopilot.enabled).toBe(false);
    expect(snapshot.autopilot.status).toBe('arrived');
    expect(distance(snapshot.ship.position, field.position)).toBeLessThan(40);
    expect(snapshot.ship.speed).toBeLessThanOrEqual(1.5);
    expect(snapshot.ship.hull).toBe(100);
  });

  it('flies around a large asteroid that blocks the direct route', () => {
    const simulation = new GameSimulation(undefined, 92_610, ['flight-assist']);
    simulation.launch();
    simulation.clearAsteroids();
    simulation.ship.transform.position = { x: 0, y: 500 };
    simulation.ship.transform.previousPosition = { x: 0, y: 500 };
    simulation.ship.velocity.linear = { x: 0, y: 0 };
    simulation.spawnAsteroid({
      position: { x: 40, y: 250 },
      velocity: { x: 0, y: 0 },
      radius: 82,
      sizeClass: 'large',
      name: 'Route Blocker',
    });
    const field = getNavigationDestination('kestrel-field');
    expect(field).not.toBeNull();
    if (field === null) {
      return;
    }
    simulation.setNavigationBeacon(field);
    simulation.toggleAutopilot();
    let avoidanceObserved = false;
    let minimumSurfaceClearance = Number.POSITIVE_INFINITY;
    let maximumObservedSpeed = 0;
    let firstRoute: Array<{ x: number; y: number }> = [];

    for (let index = 0; index < tuning.simulationHz * 100; index += 1) {
      simulation.step(dt, neutralFlightActions());
      const snapshot = simulation.getDebugSnapshot();
      avoidanceObserved ||= snapshot.autopilot.status === 'avoidance';
      maximumObservedSpeed = Math.max(maximumObservedSpeed, snapshot.ship.speed);
      if (firstRoute.length === 0 && snapshot.autopilot.path.length > 0) {
        firstRoute = snapshot.autopilot.path;
      }
      minimumSurfaceClearance = Math.min(
        minimumSurfaceClearance,
        distance(snapshot.ship.position, { x: 40, y: 250 })
          - 82
          - tuning.ship.radius,
      );
      if (!snapshot.autopilot.enabled) {
        break;
      }
    }

    const snapshot = simulation.getDebugSnapshot();
    expect(avoidanceObserved).toBe(true);
    expect(snapshot.autopilot.status).toBe('arrived');
    expect(
      snapshot.ship.hull,
      `minimum surface clearance ${minimumSurfaceClearance.toFixed(2)} m; max speed ${maximumObservedSpeed.toFixed(2)}; route ${JSON.stringify(firstRoute)}`,
    ).toBe(100);
    expect(minimumSurfaceClearance).toBeGreaterThan(0);
    expect(distance(snapshot.ship.position, field.position)).toBeLessThan(40);
  });

  it('maintains useful speed and generous clearance around a very-large route blocker', () => {
    const simulation = new GameSimulation(undefined, 71_004, ['flight-assist']);
    simulation.launch();
    simulation.clearAsteroids();
    simulation.ship.transform.position = { x: 0, y: 0 };
    simulation.ship.transform.previousPosition = { x: 0, y: 0 };
    simulation.ship.velocity.linear = { x: 0, y: 0 };
    const blocker = simulation.spawnAsteroid({
      position: { x: 0, y: -520 },
      velocity: { x: 0, y: 0 },
      radius: 300,
      sizeClass: 'very-large',
      name: 'Autopilot Stress Massif',
    });
    const destination = {
      id: 'stress-route',
      kind: 'asteroid-field' as const,
      name: 'Stress Route',
      code: 'TEST ROUTE',
      position: { x: 0, y: -1_300 },
      description: 'Autopilot regression route.',
    };
    simulation.setNavigationBeacon(destination);
    simulation.toggleAutopilot();
    let maximumObservedSpeed = 0;
    let minimumSurfaceClearance = Number.POSITIVE_INFINITY;
    let avoidanceObserved = false;

    for (let index = 0; index < tuning.simulationHz * 80; index += 1) {
      simulation.step(dt, neutralFlightActions());
      const snapshot = simulation.getDebugSnapshot();
      maximumObservedSpeed = Math.max(maximumObservedSpeed, snapshot.ship.speed);
      minimumSurfaceClearance = Math.min(
        minimumSurfaceClearance,
        distance(snapshot.ship.position, blocker.transform.position)
          - blocker.collider.radius
          - tuning.ship.radius,
      );
      avoidanceObserved ||= snapshot.autopilot.status === 'avoidance';
      if (!snapshot.autopilot.enabled) {
        break;
      }
    }

    const snapshot = simulation.getDebugSnapshot();
    expect(avoidanceObserved).toBe(true);
    expect(snapshot.autopilot.status).toBe('arrived');
    expect(snapshot.ship.hull).toBe(100);
    expect(maximumObservedSpeed).toBeGreaterThan(47);
    expect(minimumSurfaceClearance).toBeGreaterThan(30);
    expect(snapshot.elapsedSeconds).toBeLessThan(60);
  });

  it('recovers safely when engaged on a fast collision course', () => {
    const simulation = new GameSimulation(undefined, 31_777, ['flight-assist']);
    simulation.launch();
    simulation.clearAsteroids();
    simulation.ship.transform.position = { x: 0, y: 0 };
    simulation.ship.transform.previousPosition = { x: 0, y: 0 };
    simulation.ship.velocity.linear = { x: 0, y: -35 };
    simulation.spawnAsteroid({
      position: { x: 0, y: -250 },
      velocity: { x: 0, y: 0 },
      radius: 80,
      sizeClass: 'large',
      name: 'Emergency Avoidance Rock',
    });
    simulation.setNavigationBeacon({
      id: 'emergency-route',
      kind: 'asteroid-field',
      name: 'Emergency Route',
      code: 'TEST EVADE',
      position: { x: 0, y: -900 },
      description: 'Momentum-aware avoidance regression route.',
    });
    simulation.toggleAutopilot();

    for (let index = 0; index < tuning.simulationHz * 60; index += 1) {
      simulation.step(dt, neutralFlightActions());
      if (!simulation.getDebugSnapshot().autopilot.enabled) {
        break;
      }
    }

    const snapshot = simulation.getDebugSnapshot();
    expect(snapshot.ship.hull).toBe(100);
    expect(snapshot.autopilot.status).toBe('arrived');
  });

  it('crosses the live sector and docks at the second station without an impact', () => {
    const simulation = new GameSimulation(undefined, 0xb37e_2026, ['flight-assist']);
    simulation.launch();
    const pallas = getNavigationDestination('pallas-gate');
    expect(pallas).not.toBeNull();
    if (pallas === null) {
      return;
    }
    simulation.setNavigationBeacon(pallas);
    simulation.toggleAutopilot();

    for (let index = 0; index < tuning.simulationHz * 180 && simulation.phase !== 'station'; index += 1) {
      simulation.step(dt, neutralFlightActions());
    }

    const snapshot = simulation.getDebugSnapshot();
    expect(simulation.phase).toBe('station');
    expect(snapshot.dockedStation.destinationId).toBe('pallas-gate');
    expect(snapshot.ship.hull).toBe(100);
  }, 15_000);
});
