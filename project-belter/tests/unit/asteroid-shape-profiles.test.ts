import { describe, expect, it } from 'vitest';
import { getAsteroidLocalContour, getAsteroidSupportRadius } from '../../src/game/simulation/AsteroidShapeProfiles';
import { GameSimulation } from '../../src/game/simulation/GameSimulation';

describe('asteroid collision contours', () => {
  it('uses the same fitted shape for display and directional collision distance', () => {
    const simulation = new GameSimulation();
    simulation.clearAsteroids();
    const shard = simulation.spawnAsteroid({
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      radius: 100,
      spriteIndex: 1,
      shapeClass: 'shard',
    });
    const alongShard = { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
    const acrossShard = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
    const contour = getAsteroidLocalContour(shard);

    expect(contour.length).toBeGreaterThanOrEqual(8);
    expect(getAsteroidSupportRadius(shard, alongShard)).toBeGreaterThan(100);
    expect(getAsteroidSupportRadius(shard, acrossShard)).toBeLessThan(65);
  });

  it('rotates the physical outline with the sprite', () => {
    const simulation = new GameSimulation();
    simulation.clearAsteroids();
    const shard = simulation.spawnAsteroid({
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      radius: 100,
      spriteIndex: 1,
      shapeClass: 'shard',
    });
    const initialHorizontal = getAsteroidSupportRadius(shard, { x: 1, y: 0 });
    shard.transform.heading = Math.PI / 2;
    const rotatedVertical = getAsteroidSupportRadius(shard, { x: 0, y: 1 });

    expect(rotatedVertical).toBeCloseTo(initialHorizontal, 6);
  });
});
