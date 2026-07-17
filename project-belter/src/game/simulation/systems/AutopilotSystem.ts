import type { Tuning } from '../../config/tuning';
import type { Vector2 } from '../Vector2';
import { add, distance, dot, length, normalize, scale, subtract, vector } from '../Vector2';

export type AutopilotStatus = 'idle' | 'planning' | 'cruise' | 'avoidance' | 'arrived';

export interface AutopilotObstacle {
  id: number;
  position: Vector2;
  velocity: Vector2;
  radius: number;
}

export interface AutopilotTelemetry {
  status: AutopilotStatus;
  path: Vector2[];
  waypoint: Vector2 | null;
  resolvedGoal: Vector2;
  remainingDistance: number;
  maximumSpeed: number;
}

interface GridNode {
  x: number;
  y: number;
  f: number;
}

class MinHeap {
  private readonly values: GridNode[] = [];

  public push(value: GridNode): void {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if ((this.values[parent]?.f ?? 0) <= value.f) {
        break;
      }
      this.values[index] = this.values[parent] as GridNode;
      index = parent;
    }
    this.values[index] = value;
  }

  public pop(): GridNode | null {
    const first = this.values[0];
    const last = this.values.pop();
    if (first === undefined || last === undefined) {
      return first ?? null;
    }
    if (this.values.length === 0) {
      return first;
    }
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.values.length) {
        break;
      }
      const smallest = right < this.values.length
        && (this.values[right]?.f ?? Number.POSITIVE_INFINITY) < (this.values[left]?.f ?? Number.POSITIVE_INFINITY)
        ? right
        : left;
      if ((this.values[smallest]?.f ?? 0) >= last.f) {
        break;
      }
      this.values[index] = this.values[smallest] as GridNode;
      index = smallest;
    }
    this.values[index] = last;
    return first;
  }

  public get size(): number {
    return this.values.length;
  }
}

const keyFor = (x: number, y: number): string => `${x},${y}`;

const pointSegmentDistance = (point: Vector2, start: Vector2, end: Vector2): number => {
  const segment = subtract(end, start);
  const segmentLengthSquared = dot(segment, segment);
  if (segmentLengthSquared < 0.000_001) {
    return distance(point, start);
  }
  const amount = Math.min(1, Math.max(0, dot(subtract(point, start), segment) / segmentLengthSquared));
  return distance(point, add(start, scale(segment, amount)));
};

const orientation = (first: Vector2, second: Vector2, third: Vector2): number =>
  (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x);

const segmentsIntersect = (a: Vector2, b: Vector2, c: Vector2, d: Vector2): boolean => {
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  return first * second < 0 && third * fourth < 0;
};

const segmentDistance = (a: Vector2, b: Vector2, c: Vector2, d: Vector2): number => {
  if (segmentsIntersect(a, b, c, d)) {
    return 0;
  }
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  );
};

export class AutopilotSystem {
  private pathValue: Vector2[] = [];
  private pathAnchorValue: Vector2 = vector();
  private replanSeconds = 0;
  private statusValue: AutopilotStatus = 'idle';
  private resolvedGoalValue: Vector2 = vector();

  public constructor(private readonly config: Tuning) {}

  public reset(): void {
    this.pathValue = [];
    this.pathAnchorValue = vector();
    this.replanSeconds = 0;
    this.statusValue = 'idle';
    this.resolvedGoalValue = vector();
  }

  public update(
    start: Vector2,
    goal: Vector2,
    obstacles: readonly AutopilotObstacle[],
    deltaSeconds: number,
    arrivalRadius: number = this.config.navigation.autopilotArrivalRadius,
    shipVelocity: Vector2 = vector(),
  ): AutopilotTelemetry {
    this.replanSeconds -= deltaSeconds;
    const momentumMargin = Math.min(
      this.config.navigation.autopilotMomentumMarginMax,
      length(shipVelocity) * this.config.navigation.autopilotMomentumMarginPerSpeed,
    );
    const routedObstacles = momentumMargin <= 0.001
      ? obstacles
      : obstacles.map((obstacle) => ({
          ...obstacle,
          radius: obstacle.radius + momentumMargin,
        }));
    this.resolvedGoalValue = this.resolveSafeGoal(goal, routedObstacles);

    while (this.pathValue.length > 1) {
      const waypoint = this.pathValue[0] as Vector2;
      const reachedWaypoint = distance(start, waypoint)
        <= this.config.navigation.autopilotWaypointTolerance;
      const passedWaypoint = this.hasPassedWaypoint(start, this.pathAnchorValue, waypoint);
      if (!reachedWaypoint && !passedWaypoint) {
        break;
      }
      this.pathAnchorValue = { ...(this.pathValue.shift() as Vector2) };
    }

    const routeInvalid = this.pathValue.length > 0 && (
      distance(this.pathValue.at(-1) as Vector2, this.resolvedGoalValue) > 1
      || !this.isPathNavigable(start, this.pathValue, routedObstacles)
    );
    const firstWaypoint = this.pathValue[0];
    const closelyFollowingRoute = firstWaypoint !== undefined
      && pointSegmentDistance(start, this.pathAnchorValue, firstWaypoint)
        <= this.config.navigation.autopilotRouteTrackingTolerance;
    if (
      this.pathValue.length === 0
      || routeInvalid
      || (this.replanSeconds <= 0 && !closelyFollowingRoute)
    ) {
      this.statusValue = 'planning';
      this.pathValue = this.plan(start, this.resolvedGoalValue, routedObstacles);
      this.pathAnchorValue = { ...start };
      this.replanSeconds = this.config.navigation.autopilotReplanSeconds;
    } else if (this.replanSeconds <= 0) {
      this.replanSeconds = this.config.navigation.autopilotStableReplanSeconds;
    }

    const remainingDistance = this.routeDistance(start, this.pathValue);
    const arrived = distance(start, this.resolvedGoalValue) <= arrivalRadius;
    if (arrived) {
      this.statusValue = 'arrived';
    } else {
      const direct = this.isSegmentClear(start, this.resolvedGoalValue, routedObstacles);
      this.statusValue = direct ? 'cruise' : 'avoidance';
    }
    const maximumSpeed = this.getRouteSpeed(start, this.pathValue);

    return {
      status: this.statusValue,
      path: this.pathValue.map((point) => ({ ...point })),
      waypoint: this.pathValue[0] === undefined ? null : { ...this.pathValue[0] },
      resolvedGoal: { ...this.resolvedGoalValue },
      remainingDistance,
      maximumSpeed,
    };
  }

  public plan(start: Vector2, goal: Vector2, obstacles: readonly AutopilotObstacle[]): Vector2[] {
    if (this.isSegmentClear(start, goal, obstacles)) {
      return this.subdividePath(start, [{ ...goal }]);
    }

    const gridSize = this.config.navigation.autopilotGridSize;
    const detourMargin = this.config.navigation.autopilotSearchMargin;
    const minimumX = Math.floor((Math.min(start.x, goal.x) - detourMargin) / gridSize);
    const maximumX = Math.ceil((Math.max(start.x, goal.x) + detourMargin) / gridSize);
    const minimumY = Math.floor((Math.min(start.y, goal.y) - detourMargin) / gridSize);
    const maximumY = Math.ceil((Math.max(start.y, goal.y) + detourMargin) / gridSize);
    const startCell = { x: Math.round(start.x / gridSize), y: Math.round(start.y / gridSize) };
    const goalCell = { x: Math.round(goal.x / gridSize), y: Math.round(goal.y / gridSize) };
    const open = new MinHeap();
    const cameFrom = new Map<string, string>();
    const scores = new Map<string, number>();
    const closed = new Set<string>();
    const startKey = keyFor(startCell.x, startCell.y);
    scores.set(startKey, 0);
    open.push({ ...startCell, f: distance(startCell, goalCell) });
    const directions = [
      { x: 1, y: 0, cost: 1 }, { x: -1, y: 0, cost: 1 },
      { x: 0, y: 1, cost: 1 }, { x: 0, y: -1, cost: 1 },
      { x: 1, y: 1, cost: Math.SQRT2 }, { x: 1, y: -1, cost: Math.SQRT2 },
      { x: -1, y: 1, cost: Math.SQRT2 }, { x: -1, y: -1, cost: Math.SQRT2 },
    ];
    let visited = 0;

    while (open.size > 0 && visited < this.config.navigation.autopilotMaxNodes) {
      const current = open.pop();
      if (current === null) {
        break;
      }
      const currentKey = keyFor(current.x, current.y);
      if (closed.has(currentKey)) {
        continue;
      }
      closed.add(currentKey);
      visited += 1;
      const currentPoint = currentKey === startKey
        ? start
        : vector(current.x * gridSize, current.y * gridSize);
      if (
        (current.x === goalCell.x && current.y === goalCell.y)
        || this.isSegmentClear(currentPoint, goal, obstacles)
      ) {
        return this.smoothPath(start, goal, this.reconstructGridPath(currentKey, cameFrom, gridSize), obstacles);
      }

      for (const direction of directions) {
        const nextX = current.x + direction.x;
        const nextY = current.y + direction.y;
        if (nextX < minimumX || nextX > maximumX || nextY < minimumY || nextY > maximumY) {
          continue;
        }
        const nextPoint = vector(nextX * gridSize, nextY * gridSize);
        if (!this.isGridEdgeClear(currentPoint, nextPoint, obstacles)) {
          continue;
        }
        if (
          !(nextX === goalCell.x && nextY === goalCell.y)
          && !(nextX === startCell.x && nextY === startCell.y)
          && this.isPointBlocked(nextPoint, obstacles)
        ) {
          continue;
        }
        if (direction.x !== 0 && direction.y !== 0) {
          const horizontal = vector(nextX * gridSize, current.y * gridSize);
          const vertical = vector(current.x * gridSize, nextY * gridSize);
          if (this.isPointBlocked(horizontal, obstacles) || this.isPointBlocked(vertical, obstacles)) {
            continue;
          }
        }
        const nextKey = keyFor(nextX, nextY);
        const tentative = (scores.get(currentKey) ?? Number.POSITIVE_INFINITY) + direction.cost;
        if (tentative >= (scores.get(nextKey) ?? Number.POSITIVE_INFINITY)) {
          continue;
        }
        cameFrom.set(nextKey, currentKey);
        scores.set(nextKey, tentative);
        const heuristic = Math.hypot(goalCell.x - nextX, goalCell.y - nextY);
        open.push({ x: nextX, y: nextY, f: tentative + heuristic });
      }
    }

    return this.fallbackDetour(start, goal, obstacles);
  }

  private hasPassedWaypoint(start: Vector2, anchor: Vector2, waypoint: Vector2): boolean {
    const inboundLeg = subtract(waypoint, anchor);
    const legLengthSquared = dot(inboundLeg, inboundLeg);
    if (legLengthSquared < 0.000_001) {
      return false;
    }
    return dot(subtract(start, waypoint), inboundLeg) >= 0;
  }

  public isSegmentClear(
    start: Vector2,
    end: Vector2,
    obstacles: readonly AutopilotObstacle[],
  ): boolean {
    return obstacles.every((obstacle) => {
      const predicted = add(
        obstacle.position,
        scale(obstacle.velocity, this.config.navigation.autopilotPredictionSeconds),
      );
      return segmentDistance(start, end, obstacle.position, predicted) > this.inflatedRadius(obstacle);
    });
  }

  public isPathClear(
    start: Vector2,
    path: readonly Vector2[],
    obstacles: readonly AutopilotObstacle[],
  ): boolean {
    let previous = start;
    for (const waypoint of path) {
      if (!this.isSegmentClear(previous, waypoint, obstacles)) {
        return false;
      }
      previous = waypoint;
    }
    return true;
  }

  private isPathNavigable(
    start: Vector2,
    path: readonly Vector2[],
    obstacles: readonly AutopilotObstacle[],
  ): boolean {
    let previous = start;
    for (const [index, waypoint] of path.entries()) {
      const clear = index === 0
        ? this.isGridEdgeClear(previous, waypoint, obstacles)
        : this.isSegmentClear(previous, waypoint, obstacles);
      if (!clear) {
        return false;
      }
      previous = waypoint;
    }
    return true;
  }

  private isGridEdgeClear(
    start: Vector2,
    end: Vector2,
    obstacles: readonly AutopilotObstacle[],
  ): boolean {
    return obstacles.every((obstacle) => {
      const predicted = add(
        obstacle.position,
        scale(obstacle.velocity, this.config.navigation.autopilotPredictionSeconds),
      );
      const radius = this.inflatedRadius(obstacle);
      const startClearance = pointSegmentDistance(start, obstacle.position, predicted);
      if (startClearance <= radius) {
        return pointSegmentDistance(end, obstacle.position, predicted) > startClearance;
      }
      return segmentDistance(start, end, obstacle.position, predicted) > radius;
    });
  }

  private isPointBlocked(point: Vector2, obstacles: readonly AutopilotObstacle[]): boolean {
    return obstacles.some((obstacle) => {
      const predicted = add(
        obstacle.position,
        scale(obstacle.velocity, this.config.navigation.autopilotPredictionSeconds),
      );
      return pointSegmentDistance(point, obstacle.position, predicted) <= this.inflatedRadius(obstacle);
    });
  }

  private inflatedRadius(obstacle: AutopilotObstacle): number {
    return obstacle.radius
      + this.config.ship.radius
      + this.config.navigation.autopilotSafetyMargin
      + Math.min(18, length(obstacle.velocity) * 1.5);
  }

  private resolveSafeGoal(goal: Vector2, obstacles: readonly AutopilotObstacle[]): Vector2 {
    let resolved = { ...goal };
    for (let pass = 0; pass < 5; pass += 1) {
      const blocker = obstacles.find((obstacle) =>
        distance(resolved, obstacle.position) <= this.inflatedRadius(obstacle));
      if (blocker === undefined) {
        break;
      }
      const away = distance(resolved, blocker.position) > 0.001
        ? normalize(subtract(resolved, blocker.position))
        : vector(0, -1);
      resolved = add(blocker.position, scale(away, this.inflatedRadius(blocker) + 12));
    }
    return resolved;
  }

  private reconstructGridPath(
    goalKey: string,
    cameFrom: ReadonlyMap<string, string>,
    gridSize: number,
  ): Vector2[] {
    const path: Vector2[] = [];
    let current: string | undefined = goalKey;
    while (current !== undefined) {
      const [x, y] = current.split(',').map(Number);
      path.push(vector((x ?? 0) * gridSize, (y ?? 0) * gridSize));
      current = cameFrom.get(current);
    }
    return path.reverse();
  }

  private smoothPath(
    start: Vector2,
    goal: Vector2,
    gridPath: readonly Vector2[],
    obstacles: readonly AutopilotObstacle[],
  ): Vector2[] {
    const candidates = [
      ...gridPath.slice(1),
      ...(distance(gridPath.at(-1) ?? start, goal) > 0.01 ? [{ ...goal }] : []),
    ];
    const result: Vector2[] = [];
    let anchor = { ...start };
    let index = 0;
    while (index < candidates.length) {
      let nextIndex = candidates.length - 1;
      while (
        nextIndex > index
        && (
          distance(anchor, candidates[nextIndex] as Vector2)
            > this.config.navigation.autopilotMaxShortcutDistance
          || !(result.length === 0
            ? this.isGridEdgeClear(anchor, candidates[nextIndex] as Vector2, obstacles)
            : this.isSegmentClear(anchor, candidates[nextIndex] as Vector2, obstacles))
        )
      ) {
        nextIndex -= 1;
      }
      const waypoint = candidates[nextIndex] as Vector2;
      const segmentClear = result.length === 0
        ? this.isGridEdgeClear(anchor, waypoint, obstacles)
        : this.isSegmentClear(anchor, waypoint, obstacles);
      if (!segmentClear) {
        return this.fallbackDetour(start, goal, obstacles);
      }
      result.push({ ...waypoint });
      anchor = waypoint;
      index = nextIndex + 1;
    }
    return result.length > 0 && this.isPathNavigable(start, result, obstacles)
      ? this.subdividePath(start, result)
      : this.fallbackDetour(start, goal, obstacles);
  }

  private routeDistance(start: Vector2, path: readonly Vector2[]): number {
    let total = 0;
    let previous = start;
    for (const point of path) {
      total += distance(previous, point);
      previous = point;
    }
    return total;
  }

  private subdividePath(start: Vector2, path: readonly Vector2[]): Vector2[] {
    const result: Vector2[] = [];
    let previous = start;
    for (const point of path) {
      const segmentLength = distance(previous, point);
      const divisions = Math.max(
        1,
        Math.ceil(segmentLength / this.config.navigation.autopilotMaxShortcutDistance),
      );
      for (let division = 1; division <= divisions; division += 1) {
        const amount = division / divisions;
        result.push({
          x: previous.x + (point.x - previous.x) * amount,
          y: previous.y + (point.y - previous.y) * amount,
        });
      }
      previous = point;
    }
    return result;
  }

  private getRouteSpeed(start: Vector2, path: readonly Vector2[]): number {
    const cruiseSpeed = this.config.navigation.autopilotCruiseSpeed;
    const first = path[0];
    const second = path[1];
    if (first === undefined || second === undefined) {
      return cruiseSpeed;
    }

    const incoming = normalize(subtract(first, start));
    const outgoing = normalize(subtract(second, first));
    const turnSharpness = Math.sqrt(Math.max(0, (1 - dot(incoming, outgoing)) * 0.5));
    const cornerSpeed = cruiseSpeed
      - (cruiseSpeed - this.config.navigation.autopilotMinimumCornerSpeed) * turnSharpness;
    const brakingDistance = Math.max(
      0,
      distance(start, first) - this.config.navigation.autopilotWaypointTolerance,
    );
    const brakingSpeed = Math.sqrt(
      cornerSpeed * cornerSpeed
        + 2 * this.config.navigation.autopilotCornerDeceleration * brakingDistance,
    );
    return Math.min(cruiseSpeed, Math.max(cornerSpeed, brakingSpeed));
  }

  private fallbackDetour(
    start: Vector2,
    goal: Vector2,
    obstacles: readonly AutopilotObstacle[],
  ): Vector2[] {
    const blocker = obstacles
      .filter((obstacle) => {
        const predicted = add(
          obstacle.position,
          scale(obstacle.velocity, this.config.navigation.autopilotPredictionSeconds),
        );
        return segmentDistance(start, goal, obstacle.position, predicted) <= this.inflatedRadius(obstacle);
      })
      .sort((first, second) => distance(start, first.position) - distance(start, second.position))[0];
    if (blocker === undefined) {
      return [{ ...goal }];
    }
    const routeDirection = normalize(subtract(goal, start));
    const perpendicular = vector(-routeDirection.y, routeDirection.x);
    const clearance = this.inflatedRadius(blocker) + this.config.navigation.autopilotGridSize;
    const candidates = [
      add(blocker.position, scale(perpendicular, clearance)),
      add(blocker.position, scale(perpendicular, -clearance)),
    ].sort((first, second) =>
      distance(start, first) + distance(first, goal) - distance(start, second) - distance(second, goal));
    for (const candidate of candidates) {
      const route = [{ ...candidate }, { ...goal }];
      if (this.isPathNavigable(start, route, obstacles)) {
        return this.subdividePath(start, route);
      }
    }

    const ringRadius = clearance + this.config.navigation.autopilotGridSize * 0.35;
    const ring = Array.from({ length: 16 }, (_, index) => {
      const angle = index / 16 * Math.PI * 2;
      return add(blocker.position, vector(
        Math.cos(angle) * ringRadius,
        Math.sin(angle) * ringRadius,
      ));
    });
    const routes: Vector2[][] = [];
    for (let first = 0; first < ring.length; first += 1) {
      for (let step = 1; step < ring.length / 2; step += 1) {
        const clockwise = [
          ring[first] as Vector2,
          ring[(first + step) % ring.length] as Vector2,
          goal,
        ];
        const counterClockwise = [
          ring[first] as Vector2,
          ring[(first - step + ring.length) % ring.length] as Vector2,
          goal,
        ];
        if (this.isPathNavigable(start, clockwise, obstacles)) {
          routes.push(clockwise);
        }
        if (this.isPathNavigable(start, counterClockwise, obstacles)) {
          routes.push(counterClockwise);
        }
      }
    }
    routes.sort((first, second) => this.routeDistance(start, first) - this.routeDistance(start, second));
    return routes[0] === undefined
      ? [{ ...start }]
      : this.subdividePath(start, routes[0]);
  }
}
