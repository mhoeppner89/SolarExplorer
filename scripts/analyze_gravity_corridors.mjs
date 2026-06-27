import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const htmlPath = path.join(root, "gravity_sling.html");
const solutionsPath = path.join(root, "docs", "gravity_sling_solutions", "solutions.json");

const html = fs.readFileSync(htmlPath, "utf8");
const loggedData = JSON.parse(fs.readFileSync(solutionsPath, "utf8"));

function numberConst(name) {
  const match = html.match(new RegExp(`const ${name} = ([^;]+);`));
  if (!match) throw new Error(`Missing const ${name}`);
  return Number(new Function(`return ${match[1]};`)());
}

function arrayConst(name) {
  const match = html.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\]);`));
  if (!match) throw new Error(`Missing const ${name}`);
  return new Function(`return ${match[1]};`)();
}

const levelsMarker = "const levels = ";
const levelsStart = html.indexOf(levelsMarker);
const levelsArrayStart = levelsStart === -1 ? -1 : html.indexOf("[", levelsStart);
const levelsEnd = levelsArrayStart === -1 ? -1 : html.indexOf("\n            ];", levelsArrayStart);
if (levelsStart === -1 || levelsArrayStart === -1 || levelsEnd === -1) {
  throw new Error("Could not locate Gravity Sling levels array.");
}

const levelsSource = html.slice(levelsArrayStart, levelsEnd + "\n            ]".length);
const levels = new Function(`return ${levelsSource};`)();

const WORLD = { width: 540, height: 960 };
const SHIP_RADIUS = numberConst("SHIP_RADIUS");
const MAX_LAUNCH_PULL = numberConst("MAX_LAUNCH_PULL");
const MAX_DRAG = numberConst("MAX_DRAG");
const LAUNCH_POWER = numberConst("LAUNCH_POWER");
const FIXED_DT = numberConst("FIXED_DT");
const TIME_LIMIT = numberConst("TIME_LIMIT");
const FLY_MARGIN = numberConst("FLY_MARGIN");
const GRAVITY_SCALE = numberConst("GRAVITY_SCALE");
const HEAT_LIMIT = numberConst("HEAT_LIMIT");
const SUN_HEAT_GAIN_RATE = numberConst("SUN_HEAT_GAIN_RATE");
const HEAT_COOL_RATE = numberConst("HEAT_COOL_RATE");
const SHADOW_COOL_RATE = numberConst("SHADOW_COOL_RATE");
const DEFAULT_HEAT_RADIUS_MULTIPLIER = numberConst("DEFAULT_HEAT_RADIUS_MULTIPLIER");
const SCORE_BEST_POINTS = numberConst("SCORE_BEST_POINTS");
const SCORE_FULL_POWER_POINTS = numberConst("SCORE_FULL_POWER_POINTS");
const SCORE_BEST_LAUNCH_SPEEDS = arrayConst("SCORE_BEST_LAUNCH_SPEEDS");
const LAUNCH_DEAD_ZONE_RATIO = numberConst("LAUNCH_DEAD_ZONE_RATIO");
const MIN_LAUNCH_RATIO = numberConst("MIN_LAUNCH_RATIO");
const DEAD_DRAG_PULL = MAX_DRAG * LAUNCH_DEAD_ZONE_RATIO;
const MIN_DRAG_PULL = MAX_DRAG * MIN_LAUNCH_RATIO;
const MIN_LAUNCH_PULL = MAX_LAUNCH_PULL * MIN_LAUNCH_RATIO;
const LOGGED_DRAG_SCALE = MAX_DRAG / (loggedData.constants?.maxDrag || MAX_DRAG);
const loggedSolutions = loggedData.solutions.map((solution) => ({
  ...solution,
  radius: solution.radius * LOGGED_DRAG_SCALE,
  pull: solution.pull
    ? {
      x: solution.pull.x * LOGGED_DRAG_SCALE,
      y: solution.pull.y * LOGGED_DRAG_SCALE,
    }
    : solution.pull,
}));
const IGNORE_HAZARDS = process.env.IGNORE_HAZARDS === "1";
const FIND_BEST = process.env.FIND_BEST === "1";
const FIND_LEVEL = Number(process.env.FIND_LEVEL || 0);
const TRACE_LEVEL = Number(process.env.TRACE_LEVEL || 0);
const CANDIDATE_LEVEL = Number(process.env.CANDIDATE_LEVEL || 0);
const OUTCOME_LEVEL = Number(process.env.OUTCOME_LEVEL || 0);
const TRACE_RADIUS = Number(process.env.TRACE_RADIUS || 0);
const TRACE_ANGLE = Number(process.env.TRACE_ANGLE || 0);

function length(x, y) {
  return Math.hypot(x, y);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function softeningFor(planet) {
  return planet.softening || Math.max(72, planet.r * 1.8);
}

function atmosphereStrengthAt(x, y, planet) {
  if (!planet.atmosphereRadius || !planet.atmosphereDrag) return 0;
  const distance = length(x - planet.x, y - planet.y);
  if (distance >= planet.atmosphereRadius) return 0;
  const innerEdge = planet.r + SHIP_RADIUS;
  const width = Math.max(1, planet.atmosphereRadius - innerEdge);
  return Math.pow(clamp((planet.atmosphereRadius - distance) / width, 0, 1), 1.35);
}

function isHeatSource(planet) {
  return Boolean(planet.heatRadius || planet.hotRadius || planet.label === "Sonne");
}

function heatRadiusFor(planet) {
  if (!isHeatSource(planet)) return 0;
  return planet.heatRadius || Math.max(planet.r * 2.8, (planet.hotRadius || planet.r * 2.2) * DEFAULT_HEAT_RADIUS_MULTIPLIER);
}

function heatRateFor(planet) {
  return planet.heatRate || SUN_HEAT_GAIN_RATE;
}

function heatOccluders(level, source) {
  return [
    ...level.planets.filter((body) => body !== source),
    ...(level.hazards || []),
  ];
}

function isCoveredFromHeatSource(x, y, source, level) {
  const rayX = x - source.x;
  const rayY = y - source.y;
  const rayLengthSq = rayX * rayX + rayY * rayY;
  if (rayLengthSq <= 1) return false;

  for (const body of heatOccluders(level, source)) {
    const bodyX = body.x - source.x;
    const bodyY = body.y - source.y;
    const t = (bodyX * rayX + bodyY * rayY) / rayLengthSq;
    if (t <= 0 || t >= 1) continue;
    const closestX = source.x + rayX * t;
    const closestY = source.y + rayY * t;
    const coverRadius = body.coverRadius || body.r + SHIP_RADIUS * 0.8;
    if (length(body.x - closestX, body.y - closestY) <= coverRadius) return true;
  }

  return false;
}

function thermalAt(x, y, level) {
  let strongest = {
    exposure: 0,
    heatRate: 0,
    rawExposure: 0,
    inShadow: false,
    sourceLabel: "",
  };

  for (const source of level.planets) {
    const heatRadius = heatRadiusFor(source);
    if (!heatRadius) continue;
    const distance = length(x - source.x, y - source.y);
    if (distance >= heatRadius) continue;
    const innerEdge = source.r + SHIP_RADIUS;
    const width = Math.max(1, heatRadius - innerEdge);
    const rawExposure = Math.pow(clamp((heatRadius - distance) / width, 0, 1), 1.2);
    const inShadow = isCoveredFromHeatSource(x, y, source, level);
    const heatRate = inShadow ? 0 : rawExposure * heatRateFor(source);
    if (heatRate > strongest.heatRate || (!strongest.heatRate && rawExposure > strongest.rawExposure)) {
      strongest = {
        exposure: inShadow ? 0 : rawExposure,
        heatRate,
        rawExposure,
        inShadow,
        sourceLabel: source.label || "Sonne",
      };
    }
  }

  return strongest;
}

function updateProbeHeat(probe, level, dt) {
  const thermal = thermalAt(probe.x, probe.y, level);
  const currentHeat = probe.heat || 0;
  if (thermal.heatRate > 0) {
    probe.heat = clamp(currentHeat + thermal.heatRate * dt, 0, HEAT_LIMIT);
  } else {
    const coolingRate = thermal.inShadow ? SHADOW_COOL_RATE : HEAT_COOL_RATE;
    probe.heat = clamp(currentHeat - coolingRate * dt, 0, HEAT_LIMIT);
  }
  return thermal;
}

function gravityAt(x, y, level) {
  let ax = 0;
  let ay = 0;
  for (const planet of level.planets) {
    const dx = planet.x - x;
    const dy = planet.y - y;
    const rawDistance = Math.max(1, length(dx, dy));
    const softening = softeningFor(planet);
    const softenedDistanceSq = dx * dx + dy * dy + softening * softening;
    const force = GRAVITY_SCALE * planet.mass / softenedDistanceSq;
    ax += (dx / rawDistance) * force;
    ay += (dy / rawDistance) * force;
  }
  return { ax, ay };
}

function applyGravity(entity, level, dt) {
  const gravity = gravityAt(entity.x, entity.y, level);
  entity.vx += gravity.ax * dt;
  entity.vy += gravity.ay * dt;
  for (const planet of level.planets) {
    const strength = atmosphereStrengthAt(entity.x, entity.y, planet);
    if (strength <= 0) continue;
    const damping = Math.exp(-planet.atmosphereDrag * strength * dt);
    entity.vx *= damping;
    entity.vy *= damping;
  }
  entity.x += entity.vx * dt;
  entity.y += entity.vy * dt;
}

function checkProbeOutcome(probe, level, elapsed) {
  for (const [index, planet] of level.planets.entries()) {
    if (length(probe.x - planet.x, probe.y - planet.y) <= SHIP_RADIUS + planet.r) {
      return `planet_${index + 1}`;
    }
  }

  if (!IGNORE_HAZARDS) {
    for (const [index, hazard] of (level.hazards || []).entries()) {
      if (length(probe.x - hazard.x, probe.y - hazard.y) <= SHIP_RADIUS + hazard.r) {
        return `hazard_${index + 1}`;
      }
    }
  }

  if ((probe.heat || 0) >= HEAT_LIMIT) return "overheated";

  const target = level.target;
  if (length(probe.x - target.x, probe.y - target.y) <= SHIP_RADIUS + target.r) {
    if (target.maxSpeed && length(probe.vx, probe.vy) > target.maxSpeed) return "too_fast";
    return "target_reached";
  }

  if (elapsed >= TIME_LIMIT) return "timeout";

  const flyMargin = Math.max(FLY_MARGIN, Math.min(WORLD.width, WORLD.height) * 0.32);
  if (probe.x < -flyMargin || probe.x > WORLD.width + flyMargin ||
    probe.y < -flyMargin || probe.y > WORLD.height + flyMargin) {
    return "flyaway";
  }

  return null;
}

function effectiveLaunchRadius(radius) {
  if (radius <= DEAD_DRAG_PULL || radius > MAX_DRAG) return null;
  const dragRatio = radius / MAX_DRAG;
  return dragRatio < MIN_LAUNCH_RATIO ? MIN_LAUNCH_PULL : dragRatio * MAX_LAUNCH_PULL;
}

function simulate(level, radius, angleDeg) {
  const effectiveRadius = effectiveLaunchRadius(radius);
  if (effectiveRadius === null) {
    return { outcome: "invalid_pull", elapsed: 0, arrivalSpeed: 0 };
  }
  const angle = angleDeg * Math.PI / 180;
  const probe = {
    x: level.launch.x,
    y: level.launch.y,
    vx: Math.cos(angle) * effectiveRadius * LAUNCH_POWER,
    vy: Math.sin(angle) * effectiveRadius * LAUNCH_POWER,
    heat: 0,
  };
  const steps = Math.ceil(TIME_LIMIT / FIXED_DT);
  for (let i = 0; i < steps; i += 1) {
    applyGravity(probe, level, FIXED_DT);
    updateProbeHeat(probe, level, FIXED_DT);
    const outcome = checkProbeOutcome(probe, level, i * FIXED_DT);
    if (outcome) {
      return {
        outcome,
        elapsed: i * FIXED_DT,
        arrivalSpeed: length(probe.vx, probe.vy),
        heat: probe.heat,
      };
    }
  }
  return { outcome: "timeout", elapsed: TIME_LIMIT, arrivalSpeed: length(probe.vx, probe.vy), heat: probe.heat };
}

function tracePath(level, radius, angleDeg, sampleEvery = 0.5) {
  const effectiveRadius = effectiveLaunchRadius(radius);
  if (effectiveRadius === null) return [];
  const angle = angleDeg * Math.PI / 180;
  const probe = {
    x: level.launch.x,
    y: level.launch.y,
    vx: Math.cos(angle) * effectiveRadius * LAUNCH_POWER,
    vy: Math.sin(angle) * effectiveRadius * LAUNCH_POWER,
    heat: 0,
  };
  const samples = [];
  let nextSample = 0;
  const steps = Math.ceil(TIME_LIMIT / FIXED_DT);
  for (let i = 0; i < steps; i += 1) {
    const elapsed = i * FIXED_DT;
    if (elapsed >= nextSample - 1e-9) {
      samples.push({
        t: elapsed,
        x: probe.x,
        y: probe.y,
        speed: length(probe.vx, probe.vy),
        heat: probe.heat,
      });
      nextSample += sampleEvery;
    }
    applyGravity(probe, level, FIXED_DT);
    updateProbeHeat(probe, level, FIXED_DT);
    const outcome = checkProbeOutcome(probe, level, elapsed);
    if (outcome) {
      samples.push({
        t: elapsed,
        x: probe.x,
        y: probe.y,
        speed: length(probe.vx, probe.vy),
        heat: probe.heat,
        outcome,
      });
      break;
    }
  }
  return samples;
}

function scoreForLaunchSpeed(launchSpeed, levelIndex) {
  const maxLaunchSpeed = MAX_LAUNCH_PULL * LAUNCH_POWER;
  const bestLaunchSpeed = SCORE_BEST_LAUNCH_SPEEDS[levelIndex] || (maxLaunchSpeed * MIN_LAUNCH_RATIO);
  if (bestLaunchSpeed >= maxLaunchSpeed) return SCORE_BEST_POINTS;

  const speed = clamp(launchSpeed, bestLaunchSpeed, maxLaunchSpeed);
  const progress = (speed - bestLaunchSpeed) / (maxLaunchSpeed - bestLaunchSpeed);
  const score = SCORE_BEST_POINTS + (SCORE_FULL_POWER_POINTS - SCORE_BEST_POINTS) * progress;
  return Math.round(clamp(score, SCORE_FULL_POWER_POINTS, SCORE_BEST_POINTS));
}

function solutionRecord(level, levelIndex, radius, angleDeg, result) {
  const angle = angleDeg * Math.PI / 180;
  const launchRadius = effectiveLaunchRadius(radius) || radius;
  const pull = {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
  return {
    level: levelIndex + 1,
    name: level.name,
    score: scoreForLaunchSpeed(launchRadius * LAUNCH_POWER, levelIndex),
    radius,
    launchRadius,
    angleDeg,
    pull,
    launchSpeed: launchRadius * LAUNCH_POWER,
    ...result,
  };
}

function scan(level, levelIndex, ranges, radiusStep, angleStep) {
  const winners = [];
  for (const range of ranges) {
    const radiusMin = Math.max(MIN_DRAG_PULL, range.radiusMin);
    const radiusMax = Math.min(MAX_DRAG, range.radiusMax);
    for (let radius = radiusMin; radius <= radiusMax + 1e-9; radius += radiusStep) {
      for (let angleDeg = range.angleMin; angleDeg <= range.angleMax + 1e-9; angleDeg += angleStep) {
        const result = simulate(level, radius, angleDeg);
        if (result.outcome !== "target_reached") continue;
        winners.push(solutionRecord(level, levelIndex, radius, angleDeg, result));
      }
    }
  }
  return winners;
}

function dedupeSolutions(solutions) {
  const seen = new Set();
  const deduped = [];
  for (const solution of solutions) {
    const key = `${solution.level}:${solution.radius.toFixed(3)}:${solution.angleDeg.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(solution);
  }
  return deduped;
}

function candidateRanges(winners) {
  const sorted = [...winners].sort((a, b) => b.score - a.score || a.launchSpeed - b.launchSpeed);
  return sorted.slice(0, 12).map((winner) => ({
    radiusMin: Math.max(MIN_DRAG_PULL, winner.radius - 5),
    radiusMax: Math.min(MAX_DRAG, winner.radius + 4),
    angleMin: winner.angleDeg - 8,
    angleMax: winner.angleDeg + 8,
  }));
}

function findBestSolution(level, levelIndex) {
  const fullRange = [{ radiusMin: MIN_DRAG_PULL, radiusMax: MAX_DRAG, angleMin: -180, angleMax: 180 }];
  let winners = scan(level, levelIndex, fullRange, 2, 2);
  if (!winners.length) winners = scan(level, levelIndex, fullRange, 1, 1);
  if (!winners.length) {
    throw new Error(`No winning solution found for level ${levelIndex + 1}: ${level.name}`);
  }
  winners = dedupeSolutions([
    ...winners,
    ...scan(level, levelIndex, candidateRanges(winners), 0.5, 0.5),
  ]);
  winners = dedupeSolutions([
    ...winners,
    ...scan(level, levelIndex, candidateRanges(winners), 0.2, 0.2),
  ]);
  winners.sort((a, b) => (
    b.score - a.score ||
    a.launchSpeed - b.launchSpeed ||
    a.elapsed - b.elapsed ||
    a.arrivalSpeed - b.arrivalSpeed
  ));
  return winners[0];
}

function isWin(level, radius, angleDeg) {
  return simulate(level, radius, angleDeg).outcome === "target_reached";
}

function contiguousTolerance(test, step, max) {
  let negative = 0;
  let positive = 0;
  for (let delta = step; delta <= max + 1e-9; delta += step) {
    if (!test(-delta)) break;
    negative = delta;
  }
  for (let delta = step; delta <= max + 1e-9; delta += step) {
    if (!test(delta)) break;
    positive = delta;
  }
  return { negative, positive, narrow: Math.min(negative, positive) };
}

function categoryForLevel(levelNumber) {
  if (levelNumber <= 5) return "easy";
  if (levelNumber <= 10) return "medium";
  return "hard";
}

function analyzeSolution(solution) {
  const level = levels[solution.level - 1];
  const radius = solution.radius;
  const angleDeg = solution.angleDeg;
  const exact = simulate(level, radius, angleDeg);
  const angleTolerance = contiguousTolerance(
    (delta) => isWin(level, radius, angleDeg + delta),
    0.5,
    30,
  );
  const speedTolerance = contiguousTolerance(
    (percent) => isWin(level, radius * (1 + percent / 100), angleDeg),
    1,
    60,
  );
  return {
    level: solution.level,
    name: solution.name,
    category: categoryForLevel(solution.level),
    exact: exact.outcome,
    radius: Number(radius.toFixed(2)),
    angleDeg: Number(angleDeg.toFixed(2)),
    angleMinusDeg: Number(angleTolerance.negative.toFixed(1)),
    anglePlusDeg: Number(angleTolerance.positive.toFixed(1)),
    angleNarrowDeg: Number(angleTolerance.narrow.toFixed(1)),
    speedMinusPct: Number(speedTolerance.negative.toFixed(1)),
    speedPlusPct: Number(speedTolerance.positive.toFixed(1)),
    speedNarrowPct: Number(speedTolerance.narrow.toFixed(1)),
  };
}

const sourceSolutions = FIND_BEST
  ? (FIND_LEVEL
    ? [findBestSolution(levels[FIND_LEVEL - 1], FIND_LEVEL - 1)]
    : levels.map((level, index) => findBestSolution(level, index)))
  : loggedSolutions;

function sourceSolutionFor(levelNumber) {
  return sourceSolutions.find((solution) => solution.level === levelNumber) || loggedSolutions[levelNumber - 1];
}

const report = sourceSolutions.map(analyzeSolution);
for (const row of report) {
  console.log([
    `L${String(row.level).padStart(2, "0")}`,
    row.category.padEnd(6),
    row.exact.padEnd(14),
    `angle -${row.angleMinusDeg}/+${row.anglePlusDeg} deg`,
    `speed -${row.speedMinusPct}/+${row.speedPlusPct}%`,
    row.name,
  ].join(" | "));
}

const failed = report.filter((row) => row.exact !== "target_reached");
if (failed.length) {
  console.error(`\n${failed.length} logged optimal solution(s) failed.`);
  if (!TRACE_LEVEL && !CANDIDATE_LEVEL && !OUTCOME_LEVEL) process.exit(1);
}

if (TRACE_LEVEL) {
  const level = levels[TRACE_LEVEL - 1];
  const solution = TRACE_RADIUS
    ? solutionRecord(level, TRACE_LEVEL - 1, TRACE_RADIUS, TRACE_ANGLE, simulate(level, TRACE_RADIUS, TRACE_ANGLE))
    : sourceSolutionFor(TRACE_LEVEL);
  console.log(`\nTrace L${TRACE_LEVEL}: ${level.name}`);
  console.log(`center radius ${solution.radius.toFixed(2)}, angle ${solution.angleDeg.toFixed(2)}`);
  for (const delta of [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]) {
    const result = simulate(level, solution.radius, solution.angleDeg + delta);
    console.log(`angle ${delta >= 0 ? "+" : ""}${delta} deg -> ${result.outcome}`);
  }
  for (const percent of [-8, -6, -4, -2, 0, 2, 4, 6, 8, 10]) {
    const result = simulate(level, solution.radius * (1 + percent / 100), solution.angleDeg);
    console.log(`speed ${percent >= 0 ? "+" : ""}${percent}% -> ${result.outcome}`);
  }
  console.log("grid hard-window wins (rows speed %, columns angle deg -3..+3):");
  for (const percent of [-5, -3, -1, 0, 1, 3, 5]) {
    const row = [];
    for (const angleDelta of [-3, -2, -1, 0, 1, 2, 3]) {
      row.push(isWin(level, solution.radius * (1 + percent / 100), solution.angleDeg + angleDelta) ? "1" : ".");
    }
    console.log(`${String(percent).padStart(3)}% ${row.join("")}`);
  }
  if (TRACE_RADIUS) {
    console.log("path samples:");
    for (const sample of tracePath(level, solution.radius, solution.angleDeg, 0.5)) {
      console.log([
        `t=${sample.t.toFixed(2)}`,
        `x=${sample.x.toFixed(1)}`,
        `y=${sample.y.toFixed(1)}`,
        `v=${sample.speed.toFixed(1)}`,
        `h=${((sample.heat || 0) * 100).toFixed(0)}%`,
        sample.outcome || "",
      ].join(" ").trim());
    }
  }
}

if (CANDIDATE_LEVEL) {
  const level = levels[CANDIDATE_LEVEL - 1];
  const candidates = scan(
    level,
    CANDIDATE_LEVEL - 1,
    [{ radiusMin: MIN_DRAG_PULL, radiusMax: MAX_DRAG, angleMin: -180, angleMax: 180 }],
    1,
    1,
  ).sort((a, b) => b.score - a.score || a.launchSpeed - b.launchSpeed);
  console.log(`\nCandidate corridors L${CANDIDATE_LEVEL}: ${level.name}`);
  let shown = 0;
  for (const candidate of candidates) {
    const analyzed = analyzeSolution(candidate);
    const angleUsable = Math.max(analyzed.angleMinusDeg, analyzed.anglePlusDeg);
    const speedUsable = Math.max(analyzed.speedMinusPct, analyzed.speedPlusPct);
    if (angleUsable < 2 || speedUsable < 2) continue;
    console.log([
      `score ${candidate.score}`,
      `radius ${candidate.radius.toFixed(1)}`,
      `angle ${candidate.angleDeg.toFixed(1)}`,
      `angle -${analyzed.angleMinusDeg}/+${analyzed.anglePlusDeg}`,
      `speed -${analyzed.speedMinusPct}/+${analyzed.speedPlusPct}`,
    ].join(" | "));
    shown += 1;
    if (shown >= 12) break;
  }
  if (!shown) console.log("No coarse candidates met angle>=2 and speed>=2.");
}

if (OUTCOME_LEVEL) {
  const level = levels[OUTCOME_LEVEL - 1];
  const counts = new Map();
  for (let radius = MIN_DRAG_PULL; radius <= MAX_DRAG + 1e-9; radius += 2) {
    for (let angleDeg = -180; angleDeg <= 180 + 1e-9; angleDeg += 2) {
      const outcome = simulate(level, radius, angleDeg).outcome;
      counts.set(outcome, (counts.get(outcome) || 0) + 1);
    }
  }
  console.log(`\nOutcome counts L${OUTCOME_LEVEL}: ${level.name}`);
  for (const [outcome, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${outcome}: ${count}`);
  }
}
