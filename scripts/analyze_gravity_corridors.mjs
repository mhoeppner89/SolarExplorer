import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const htmlPath = path.join(root, "gravity_sling.html");
const solutionsPath = path.join(root, "docs", "gravity_sling_solutions", "solutions.json");

const html = fs.readFileSync(htmlPath, "utf8");
const loggedSolutions = JSON.parse(fs.readFileSync(solutionsPath, "utf8")).solutions;

function numberConst(name) {
  const match = html.match(new RegExp(`const ${name} = ([^;]+);`));
  if (!match) throw new Error(`Missing const ${name}`);
  return Number(new Function(`return ${match[1]};`)());
}

const levelsStart = html.indexOf("const levels = [");
const levelsEnd = html.indexOf("];\n\n            const stars");
if (levelsStart === -1 || levelsEnd === -1) {
  throw new Error("Could not locate Gravity Sling levels array.");
}

const levelsSource = html.slice(levelsStart + "const levels = ".length, levelsEnd) + "]";
const levels = new Function(`return ${levelsSource};`)();

const WORLD = { width: 540, height: 960 };
const SHIP_RADIUS = numberConst("SHIP_RADIUS");
const MAX_DRAG = numberConst("MAX_DRAG");
const LAUNCH_POWER = numberConst("LAUNCH_POWER");
const FIXED_DT = numberConst("FIXED_DT");
const TIME_LIMIT = numberConst("TIME_LIMIT");
const FLY_MARGIN = numberConst("FLY_MARGIN");
const GRAVITY_SCALE = numberConst("GRAVITY_SCALE");
const MIN_LAUNCH_PULL = 12;
const IGNORE_HAZARDS = process.env.IGNORE_HAZARDS === "1";
const FIND_BEST = process.env.FIND_BEST === "1";
const FIND_LEVEL = Number(process.env.FIND_LEVEL || 0);
const TRACE_LEVEL = Number(process.env.TRACE_LEVEL || 0);
const CANDIDATE_LEVEL = Number(process.env.CANDIDATE_LEVEL || 0);
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
    if (planet.hotRadius && length(probe.x - planet.x, probe.y - planet.y) <= SHIP_RADIUS + planet.hotRadius) {
      return "hot_zone";
    }
  }

  if (!IGNORE_HAZARDS) {
    for (const [index, hazard] of (level.hazards || []).entries()) {
      if (length(probe.x - hazard.x, probe.y - hazard.y) <= SHIP_RADIUS + hazard.r) {
        return `hazard_${index + 1}`;
      }
    }
  }

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

function simulate(level, radius, angleDeg) {
  const effectiveRadius = radius < MIN_LAUNCH_PULL && radius >= MIN_LAUNCH_PULL - 1e-6
    ? MIN_LAUNCH_PULL
    : radius;
  if (effectiveRadius < MIN_LAUNCH_PULL || effectiveRadius > MAX_DRAG) {
    return { outcome: "invalid_pull", elapsed: 0, arrivalSpeed: 0 };
  }
  const angle = angleDeg * Math.PI / 180;
  const probe = {
    x: level.launch.x,
    y: level.launch.y,
    vx: Math.cos(angle) * effectiveRadius * LAUNCH_POWER,
    vy: Math.sin(angle) * effectiveRadius * LAUNCH_POWER,
  };
  const steps = Math.ceil(TIME_LIMIT / FIXED_DT);
  for (let i = 0; i < steps; i += 1) {
    applyGravity(probe, level, FIXED_DT);
    const outcome = checkProbeOutcome(probe, level, i * FIXED_DT);
    if (outcome) {
      return {
        outcome,
        elapsed: i * FIXED_DT,
        arrivalSpeed: length(probe.vx, probe.vy),
      };
    }
  }
  return { outcome: "timeout", elapsed: TIME_LIMIT, arrivalSpeed: length(probe.vx, probe.vy) };
}

function tracePath(level, radius, angleDeg, sampleEvery = 0.5) {
  const effectiveRadius = radius < MIN_LAUNCH_PULL && radius >= MIN_LAUNCH_PULL - 1e-6
    ? MIN_LAUNCH_PULL
    : radius;
  const angle = angleDeg * Math.PI / 180;
  const probe = {
    x: level.launch.x,
    y: level.launch.y,
    vx: Math.cos(angle) * effectiveRadius * LAUNCH_POWER,
    vy: Math.sin(angle) * effectiveRadius * LAUNCH_POWER,
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
      });
      nextSample += sampleEvery;
    }
    applyGravity(probe, level, FIXED_DT);
    const outcome = checkProbeOutcome(probe, level, elapsed);
    if (outcome) {
      samples.push({
        t: elapsed,
        x: probe.x,
        y: probe.y,
        speed: length(probe.vx, probe.vy),
        outcome,
      });
      break;
    }
  }
  return samples;
}

function scoreForLaunchSpeed(launchSpeed, levelIndex) {
  const speedRatio = clamp(launchSpeed / (MAX_DRAG * LAUNCH_POWER), 0, 1);
  const efficiency = Math.pow(1 - speedRatio, 1.35);
  const levelBonus = (levelIndex + 1) * 100;
  return Math.round(levelBonus + 1200 * efficiency);
}

function solutionRecord(level, levelIndex, radius, angleDeg, result) {
  const angle = angleDeg * Math.PI / 180;
  const pull = {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
  return {
    level: levelIndex + 1,
    name: level.name,
    score: scoreForLaunchSpeed(radius * LAUNCH_POWER, levelIndex),
    radius,
    angleDeg,
    pull,
    launchSpeed: radius * LAUNCH_POWER,
    ...result,
  };
}

function scan(level, levelIndex, ranges, radiusStep, angleStep) {
  const winners = [];
  for (const range of ranges) {
    const radiusMin = Math.max(MIN_LAUNCH_PULL, range.radiusMin);
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
  const sorted = [...winners].sort((a, b) => b.score - a.score);
  return sorted.slice(0, 12).map((winner) => ({
    radiusMin: Math.max(MIN_LAUNCH_PULL, winner.radius - 5),
    radiusMax: Math.min(MAX_DRAG, winner.radius + 4),
    angleMin: winner.angleDeg - 8,
    angleMax: winner.angleDeg + 8,
  }));
}

function findBestSolution(level, levelIndex) {
  const fullRange = [{ radiusMin: MIN_LAUNCH_PULL, radiusMax: MAX_DRAG, angleMin: -180, angleMax: 180 }];
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
  if (!TRACE_LEVEL && !CANDIDATE_LEVEL) process.exit(1);
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
    [{ radiusMin: MIN_LAUNCH_PULL, radiusMax: MAX_DRAG, angleMin: -180, angleMax: 180 }],
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
