import { describe, expect, it } from 'vitest';
import { neutralFlightActions } from '../../src/game/input/InputActions';
import { GameSimulation } from '../../src/game/simulation/GameSimulation';

const fixedDelta = 1 / 60;

const thrustForward = () => ({
  ...neutralFlightActions(),
  thrustForward: 1,
});

describe('deterministic Newtonian flight', () => {
  it('applies lateral thrust without rotating the ship', () => {
    const simulation = new GameSimulation();
    simulation.clearAsteroids();
    simulation.launch();
    simulation.ship.velocity.linear = { x: 0, y: 0 };

    for (let index = 0; index < 60; index += 1) {
      simulation.step(fixedDelta, { ...neutralFlightActions(), strafe: 1 });
    }

    const snapshot = simulation.getDebugSnapshot();
    expect(snapshot.ship.velocity.x).toBeGreaterThan(4);
    expect(Math.abs(snapshot.ship.velocity.y)).toBeLessThan(0.001);
    expect(snapshot.ship.heading).toBeCloseTo(0, 10);
    expect(snapshot.ship.fuel).toBeLessThan(snapshot.ship.fuelCapacity);
  });

  it('retains emergency maneuvering and auxiliary forward thrust without fuel', () => {
    const simulation = new GameSimulation();
    simulation.clearAsteroids();
    simulation.launch();
    simulation.ship.velocity.linear = { x: 0, y: 0 };
    simulation.ship.fuel = 0;

    for (let index = 0; index < 60; index += 1) {
      simulation.step(fixedDelta, {
        ...neutralFlightActions(),
        thrustForward: 1,
        strafe: 0.5,
        steer: 0.5,
      });
    }

    const snapshot = simulation.getDebugSnapshot();
    expect(snapshot.ship.speed).toBeGreaterThan(0.8);
    expect(snapshot.ship.velocity.x).toBeGreaterThan(1);
    expect(snapshot.ship.heading).toBeGreaterThan(0.2);
    expect(snapshot.ship.fuel).toBe(0);
  });

  it('accelerates forward from rest on auxiliary steering engines with an empty tank', () => {
    const simulation = new GameSimulation();
    simulation.clearAsteroids();
    simulation.launch();
    simulation.ship.velocity.linear = { x: 0, y: 0 };
    simulation.ship.velocity.angular = 0;
    simulation.ship.fuel = 0;

    for (let index = 0; index < 180; index += 1) {
      simulation.step(fixedDelta, thrustForward());
    }

    const snapshot = simulation.getDebugSnapshot();
    expect(snapshot.appliedActions.thrustForward).toBe(1);
    expect(snapshot.ship.velocity.x).toBeCloseTo(0, 8);
    expect(snapshot.ship.velocity.y).toBeLessThan(-6.8);
    expect(snapshot.ship.speed).toBeGreaterThan(6.8);
    expect(snapshot.ship.fuel).toBe(0);
  });

  it('continues accelerating on auxiliary engines after fuel depletes during a held burn', () => {
    const simulation = new GameSimulation();
    simulation.clearAsteroids();
    simulation.launch();
    simulation.ship.velocity.linear = { x: 0, y: 0 };
    simulation.ship.fuel = 0.01;

    for (let index = 0; index < 60; index += 1) {
      simulation.step(fixedDelta, thrustForward());
    }
    const speedAtDepletion = simulation.getDebugSnapshot().ship.speed;
    expect(simulation.ship.fuel).toBe(0);

    for (let index = 0; index < 120; index += 1) {
      simulation.step(fixedDelta, thrustForward());
    }
    const speedAfterEmergencyBurn = simulation.getDebugSnapshot().ship.speed;

    expect(speedAfterEmergencyBurn).toBeGreaterThan(speedAtDepletion + 4.5);
    expect(simulation.getDebugSnapshot().appliedActions.thrustForward).toBe(1);
    expect(simulation.ship.fuel).toBe(0);
  });

  it('preserves velocity after thrust is released', () => {
    const simulation = new GameSimulation();
    simulation.clearAsteroids();
    simulation.launch();

    for (let index = 0; index < 120; index += 1) {
      simulation.step(fixedDelta, thrustForward());
    }
    const speedAtRelease = simulation.getDebugSnapshot().ship.speed;

    for (let index = 0; index < 180; index += 1) {
      simulation.step(fixedDelta, neutralFlightActions());
    }
    const speedAfterCoasting = simulation.getDebugSnapshot().ship.speed;

    expect(speedAtRelease).toBeGreaterThan(8);
    expect(speedAfterCoasting).toBeCloseTo(speedAtRelease, 10);
  });

  it('consumes fuel while thrusting and not while coasting', () => {
    const simulation = new GameSimulation();
    simulation.clearAsteroids();
    simulation.launch();

    for (let index = 0; index < 60; index += 1) {
      simulation.step(fixedDelta, thrustForward());
    }
    const fuelAfterBurn = simulation.ship.fuel;

    for (let index = 0; index < 120; index += 1) {
      simulation.step(fixedDelta, neutralFlightActions());
    }

    expect(fuelAfterBurn).toBeLessThan(simulation.ship.fuelCapacity);
    expect(simulation.ship.fuel).toBeCloseTo(fuelAfterBurn, 10);
  });

  it('hard-limits overall ship velocity to 150 m/s', () => {
    const simulation = new GameSimulation();
    simulation.clearAsteroids();
    simulation.launch();
    simulation.ship.velocity.linear = { x: 120, y: -120 };

    simulation.step(fixedDelta, neutralFlightActions());

    expect(simulation.getDebugSnapshot().ship.speed).toBeCloseTo(150, 8);
  });

  it('reduces acceleration as cargo mass increases', () => {
    const empty = new GameSimulation();
    const loaded = new GameSimulation();
    empty.clearAsteroids();
    loaded.clearAsteroids();
    empty.launch();
    loaded.launch();
    loaded.setCargoMass(15);

    for (let index = 0; index < 60; index += 1) {
      empty.step(fixedDelta, thrustForward());
      loaded.step(fixedDelta, thrustForward());
    }

    const emptySpeed = empty.getDebugSnapshot().ship.speed;
    const loadedSpeed = loaded.getDebugSnapshot().ship.speed;

    const launchSpeed = 2.4;
    expect(loadedSpeed - launchSpeed).toBeLessThan((emptySpeed - launchSpeed) * 0.55);
    expect((emptySpeed - launchSpeed) / (loadedSpeed - launchSpeed)).toBeCloseTo(27.8 / 12.8, 1);
  });

  it('replays the same inputs identically from the same seed', () => {
    const first = new GameSimulation(undefined, 734_901);
    const second = new GameSimulation(undefined, 734_901);
    first.launch();
    second.launch();

    for (let tick = 0; tick < 900; tick += 1) {
      const actions = {
        ...neutralFlightActions(),
        thrustForward: tick < 220 ? 0.8 : tick > 520 && tick < 700 ? 0.35 : 0,
        thrustReverse: tick >= 700 && tick < 780 ? 0.6 : 0,
        steer: tick > 80 && tick < 410 ? 0.42 : tick >= 410 && tick < 610 ? -0.3 : 0,
      };
      first.step(fixedDelta, actions);
      second.step(fixedDelta, actions);
    }

    expect(second.getDebugSnapshot()).toEqual(first.getDebugSnapshot());
    expect([...second.entities.asteroids.values()]).toEqual([...first.entities.asteroids.values()]);
  });
});
