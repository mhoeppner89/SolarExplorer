export interface Vector2 {
  x: number;
  y: number;
}

export const vector = (x = 0, y = 0): Vector2 => ({ x, y });

export const add = (a: Vector2, b: Vector2): Vector2 => ({ x: a.x + b.x, y: a.y + b.y });
export const subtract = (a: Vector2, b: Vector2): Vector2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (value: Vector2, scalar: number): Vector2 => ({ x: value.x * scalar, y: value.y * scalar });
export const dot = (a: Vector2, b: Vector2): number => a.x * b.x + a.y * b.y;
export const lengthSquared = (value: Vector2): number => dot(value, value);
export const length = (value: Vector2): number => Math.sqrt(lengthSquared(value));
export const distance = (a: Vector2, b: Vector2): number => length(subtract(a, b));

export const normalize = (value: Vector2): Vector2 => {
  const magnitude = length(value);
  return magnitude > Number.EPSILON ? scale(value, 1 / magnitude) : vector(1, 0);
};

export const clampMagnitude = (value: Vector2, maximum: number): Vector2 => {
  const magnitudeSquared = lengthSquared(value);
  if (magnitudeSquared <= maximum * maximum) {
    return { ...value };
  }
  return scale(value, maximum / Math.sqrt(magnitudeSquared));
};

export const moveTowards = (from: Vector2, to: Vector2, maximumDistance: number): Vector2 => {
  const delta = subtract(to, from);
  const magnitude = length(delta);
  if (magnitude <= maximumDistance || magnitude <= Number.EPSILON) {
    return { ...to };
  }
  return add(from, scale(delta, maximumDistance / magnitude));
};

export const rotate = (value: Vector2, angle: number): Vector2 => ({
  x: value.x * Math.cos(angle) - value.y * Math.sin(angle),
  y: value.x * Math.sin(angle) + value.y * Math.cos(angle),
});

export const lerp = (from: number, to: number, alpha: number): number => from + (to - from) * alpha;
export const lerpVector = (from: Vector2, to: Vector2, alpha: number): Vector2 => ({
  x: lerp(from.x, to.x, alpha),
  y: lerp(from.y, to.y, alpha),
});

export const wrapAngle = (angle: number): number => {
  let wrapped = (angle + Math.PI) % (Math.PI * 2);
  if (wrapped < 0) {
    wrapped += Math.PI * 2;
  }
  return wrapped - Math.PI;
};

export const lerpAngle = (from: number, to: number, alpha: number): number =>
  from + wrapAngle(to - from) * alpha;

/** Heading zero points toward negative Y, matching a ship sprite drawn nose-up. */
export const forwardFromHeading = (heading: number): Vector2 => ({
  x: Math.sin(heading),
  y: -Math.cos(heading),
});

export const headingFromVector = (direction: Vector2): number =>
  Math.atan2(direction.x, -direction.y);

export const rightFromHeading = (heading: number): Vector2 => ({
  x: Math.cos(heading),
  y: Math.sin(heading),
});
