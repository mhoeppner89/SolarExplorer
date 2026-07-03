import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const htmlPath = path.join(root, "gravity_sling.html");
const outDir = path.join(root, "docs", "gravity_sling_solutions");
const screenshotDir = path.join(outDir, "screenshots");
const markdownPath = path.join(outDir, "README.md");
const jsonPath = path.join(outDir, "solutions.json");

const html = fs.readFileSync(htmlPath, "utf8");

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
const MAX_LAUNCH_SPEED = MAX_LAUNCH_PULL * LAUNCH_POWER;
const FIXED_DT = numberConst("FIXED_DT");
const TIME_LIMIT = numberConst("TIME_LIMIT");
const FLY_MARGIN = numberConst("FLY_MARGIN");
const GRAVITY_SCALE = numberConst("GRAVITY_SCALE");
const HEAT_LIMIT = numberConst("HEAT_LIMIT");
const SUN_HEAT_GAIN_RATE = numberConst("SUN_HEAT_GAIN_RATE");
const HEAT_COOL_RATE = numberConst("HEAT_COOL_RATE");
const SHADOW_COOL_RATE = numberConst("SHADOW_COOL_RATE");
const DEFAULT_HEAT_RADIUS_MULTIPLIER = numberConst("DEFAULT_HEAT_RADIUS_MULTIPLIER");
const GATE_CAPTURE_MARGIN = numberConst("GATE_CAPTURE_MARGIN");
const SCORE_BEST_POINTS = numberConst("SCORE_BEST_POINTS");
const SCORE_FULL_POWER_POINTS = numberConst("SCORE_FULL_POWER_POINTS");
const SCORE_BEST_LAUNCH_SPEEDS = arrayConst("SCORE_BEST_LAUNCH_SPEEDS");
const SOURCE_PREDICTION_TIME_RATIO = numberConst("PREDICTION_TIME_RATIO");
const SCREENSHOT_PREDICTION_TIME_RATIO = process.env.GRAVITY_SOLUTION_PREDICTION_RATIO === undefined
  ? SOURCE_PREDICTION_TIME_RATIO
  : Number(process.env.GRAVITY_SOLUTION_PREDICTION_RATIO);
const REQUESTED_LEVELS = parseRequestedLevels(process.env.SOLUTION_LEVELS || process.env.SOLUTION_LEVEL || "");
const ROBUST_SCORE_TOLERANCE = 5;
const LAUNCH_DEAD_ZONE_RATIO = numberConst("LAUNCH_DEAD_ZONE_RATIO");
const MIN_LAUNCH_RATIO = numberConst("MIN_LAUNCH_RATIO");
const DEAD_DRAG_PULL = MAX_DRAG * LAUNCH_DEAD_ZONE_RATIO;
const MIN_DRAG_PULL = MAX_DRAG * MIN_LAUNCH_RATIO;
const MIN_LAUNCH_PULL = MAX_LAUNCH_PULL * MIN_LAUNCH_RATIO;

if (!Number.isFinite(SCREENSHOT_PREDICTION_TIME_RATIO) || SCREENSHOT_PREDICTION_TIME_RATIO <= 0) {
  throw new Error("GRAVITY_SOLUTION_PREDICTION_RATIO must be a positive number when provided.");
}

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
  return {
    ...thermal,
    heat: probe.heat,
  };
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
  let atmosphereTime = 0;
  let maxAtmosphereStrength = 0;
  for (const planet of level.planets) {
    const strength = atmosphereStrengthAt(entity.x, entity.y, planet);
    if (strength <= 0) continue;
    atmosphereTime = dt;
    maxAtmosphereStrength = Math.max(maxAtmosphereStrength, strength);
    const damping = Math.exp(-planet.atmosphereDrag * strength * dt);
    entity.vx *= damping;
    entity.vy *= damping;
  }
  entity.x += entity.vx * dt;
  entity.y += entity.vy * dt;
  return { atmosphereTime, maxAtmosphereStrength };
}

function routeGatesFor(level) {
  return level.gates || [];
}

function routeGateId(gate, index) {
  return gate.id || `gate-${index + 1}`;
}

function createRouteGateState(level) {
  return routeGatesFor(level).reduce((gateState, gate, index) => {
    gateState[routeGateId(gate, index)] = false;
    return gateState;
  }, {});
}

function routeGateCollected(routeGateState, gate, index) {
  return Boolean(routeGateState && routeGateState[routeGateId(gate, index)]);
}

function nextRequiredRouteGateIndex(level, routeGateState) {
  return routeGatesFor(level).findIndex((gate, index) => (
    gate.required !== false && !routeGateCollected(routeGateState, gate, index)
  ));
}

function canCollectRouteGate(level, routeGateState, gate, index) {
  if (!level.orderedGates || gate.required === false) return true;
  return index === nextRequiredRouteGateIndex(level, routeGateState);
}

function updateRouteGates(probe, level, routeGateState) {
  for (const [index, gate] of routeGatesFor(level).entries()) {
    const id = routeGateId(gate, index);
    if (routeGateState[id]) continue;
    if (!canCollectRouteGate(level, routeGateState, gate, index)) continue;
    const captureRadius = (gate.captureRadius || gate.r || 24) + SHIP_RADIUS + GATE_CAPTURE_MARGIN;
    if (length(probe.x - gate.x, probe.y - gate.y) <= captureRadius) {
      routeGateState[id] = true;
    }
  }
}

function allRequiredRouteGatesCollected(level, routeGateState) {
  return routeGatesFor(level).every((gate, index) => (
    gate.required === false || routeGateCollected(routeGateState, gate, index)
  ));
}

function checkProbeOutcome(probe, level, elapsed, routeGateState = createRouteGateState(level)) {
  for (const planet of level.planets) {
    if (length(probe.x - planet.x, probe.y - planet.y) <= SHIP_RADIUS + planet.r) {
      return "planet_collision";
    }
  }

  for (const hazard of level.hazards || []) {
    if (length(probe.x - hazard.x, probe.y - hazard.y) <= SHIP_RADIUS + hazard.r) {
      return "hazard_collision";
    }
  }

  if ((probe.heat || 0) >= HEAT_LIMIT) return "overheated";

  const target = level.target;
  if (length(probe.x - target.x, probe.y - target.y) <= SHIP_RADIUS + target.r) {
    if (!allRequiredRouteGatesCollected(level, routeGateState)) return null;
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

function scoreForLaunchSpeed(launchSpeed, levelIndex) {
  const bestLaunchSpeed = SCORE_BEST_LAUNCH_SPEEDS[levelIndex] || (MAX_LAUNCH_SPEED * MIN_LAUNCH_RATIO);
  if (bestLaunchSpeed >= MAX_LAUNCH_SPEED) return SCORE_BEST_POINTS;

  const speed = clamp(launchSpeed, bestLaunchSpeed, MAX_LAUNCH_SPEED);
  const progress = (speed - bestLaunchSpeed) / (MAX_LAUNCH_SPEED - bestLaunchSpeed);
  const score = SCORE_BEST_POINTS + (SCORE_FULL_POWER_POINTS - SCORE_BEST_POINTS) * progress;
  return Math.round(clamp(score, SCORE_FULL_POWER_POINTS, SCORE_BEST_POINTS));
}

function normalizedLaunchPull(pullX, pullY) {
  const rawRadius = length(pullX, pullY);
  if (rawRadius <= DEAD_DRAG_PULL || rawRadius > MAX_DRAG) return null;
  const dragRatio = rawRadius / MAX_DRAG;
  const launchRadius = dragRatio < MIN_LAUNCH_RATIO
    ? MIN_LAUNCH_PULL
    : dragRatio * MAX_LAUNCH_PULL;
  const scale = launchRadius / rawRadius;
  return {
    rawRadius,
    launchRadius,
    pullX: pullX * scale,
    pullY: pullY * scale,
  };
}

function simulate(level, pullX, pullY) {
  const launchPull = normalizedLaunchPull(pullX, pullY);
  if (!launchPull) {
    return { outcome: "invalid_pull", elapsed: 0, arrivalSpeed: 0 };
  }
  const probe = {
    x: level.launch.x,
    y: level.launch.y,
    vx: launchPull.pullX * LAUNCH_POWER,
    vy: launchPull.pullY * LAUNCH_POWER,
    heat: 0,
  };
  let atmosphereTime = 0;
  let maxAtmosphereStrength = 0;
  let heatTime = 0;
  let maxHeat = 0;
  let maxHeatExposure = 0;
  let shadowTime = 0;
  let minTargetDistance = Infinity;
  const routeGateState = createRouteGateState(level);
  const steps = Math.ceil(TIME_LIMIT / FIXED_DT);

  for (let i = 0; i < steps; i += 1) {
    const atmosphere = applyGravity(probe, level, FIXED_DT);
    atmosphereTime += atmosphere.atmosphereTime;
    maxAtmosphereStrength = Math.max(maxAtmosphereStrength, atmosphere.maxAtmosphereStrength);
    const thermal = updateProbeHeat(probe, level, FIXED_DT);
    if (thermal.heatRate > 0) heatTime += FIXED_DT;
    if (thermal.inShadow) shadowTime += FIXED_DT;
    maxHeat = Math.max(maxHeat, probe.heat);
    maxHeatExposure = Math.max(maxHeatExposure, thermal.exposure);
    minTargetDistance = Math.min(minTargetDistance, length(probe.x - level.target.x, probe.y - level.target.y));
    updateRouteGates(probe, level, routeGateState);

    const outcome = checkProbeOutcome(probe, level, i * FIXED_DT, routeGateState);
    if (outcome) {
      return {
        outcome,
        elapsed: i * FIXED_DT,
        x: probe.x,
        y: probe.y,
        arrivalSpeed: length(probe.vx, probe.vy),
        atmosphereTime,
        maxAtmosphereStrength,
        heatTime,
        maxHeat,
        maxHeatExposure,
        shadowTime,
        minTargetDistance,
      };
    }
  }

  return {
    outcome: "timeout",
    elapsed: TIME_LIMIT,
    x: probe.x,
    y: probe.y,
    arrivalSpeed: length(probe.vx, probe.vy),
    atmosphereTime,
    maxAtmosphereStrength,
    heatTime,
    maxHeat,
    maxHeatExposure,
    shadowTime,
    minTargetDistance,
  };
}

function solutionRecord(level, levelIndex, pullX, pullY, result) {
  const radius = length(pullX, pullY);
  const launchPull = normalizedLaunchPull(pullX, pullY);
  const launchRadius = launchPull ? launchPull.launchRadius : radius;
  const launchSpeed = launchRadius * LAUNCH_POWER;
  const drag = {
    x: level.launch.x - pullX,
    y: level.launch.y - pullY,
  };
  return {
    level: levelIndex + 1,
    name: level.name,
    score: scoreForLaunchSpeed(launchSpeed, levelIndex),
    powerPercent: Math.round(launchRadius / MAX_LAUNCH_PULL * 100),
    radius,
    launchRadius,
    angleDeg: Math.atan2(pullY, pullX) * 180 / Math.PI,
    pull: { x: pullX, y: pullY },
    drag,
    launch: { ...level.launch },
    target: { ...level.target },
    launchSpeed,
    ...result,
  };
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

function scan(level, levelIndex, ranges, radiusStep, angleStep) {
  const winners = [];
  for (const range of ranges) {
    const radiusMin = Math.max(MIN_DRAG_PULL, range.radiusMin);
    for (let radius = radiusMin; radius <= range.radiusMax + 0.0001; radius += radiusStep) {
      for (let angleDeg = range.angleMin; angleDeg <= range.angleMax + 0.0001; angleDeg += angleStep) {
        const angle = angleDeg * Math.PI / 180;
        const pullX = Math.cos(angle) * radius;
        const pullY = Math.sin(angle) * radius;
        const result = simulate(level, pullX, pullY);
        if (result.outcome !== "target_reached") continue;
        winners.push(solutionRecord(level, levelIndex, pullX, pullY, result));
      }
    }
  }
  return winners;
}

function isWin(level, radius, angleDeg) {
  const angle = angleDeg * Math.PI / 180;
  return simulate(level, Math.cos(angle) * radius, Math.sin(angle) * radius).outcome === "target_reached";
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
  return { negative, positive };
}

function solutionRobustness(level, solution) {
  const angleTolerance = contiguousTolerance(
    (delta) => isWin(level, solution.radius, solution.angleDeg + delta),
    0.5,
    20,
  );
  const speedTolerance = contiguousTolerance(
    (percent) => isWin(level, solution.radius * (1 + percent / 100), solution.angleDeg),
    1,
    30,
  );
  const angleUsable = Math.max(angleTolerance.negative, angleTolerance.positive);
  const speedUsable = Math.max(speedTolerance.negative, speedTolerance.positive);
  return {
    angleUsable,
    speedUsable,
    balanced: Math.min(angleUsable, speedUsable),
    total: angleUsable + speedUsable,
  };
}

function sortWinners(level, winners) {
  const bestScore = Math.max(...winners.map((winner) => winner.score));
  const robustness = new Map();
  const robust = (winner) => {
    const key = `${winner.radius.toFixed(3)}:${winner.angleDeg.toFixed(3)}`;
    if (!robustness.has(key)) robustness.set(key, solutionRobustness(level, winner));
    return robustness.get(key);
  };
  winners.sort((a, b) => {
    const aNearBest = a.score >= bestScore - ROBUST_SCORE_TOLERANCE;
    const bNearBest = b.score >= bestScore - ROBUST_SCORE_TOLERANCE;
    if (aNearBest !== bNearBest) return bNearBest - aNearBest;

    const aRobust = robust(a);
    const bRobust = robust(b);
    return (
      bRobust.balanced - aRobust.balanced ||
      bRobust.total - aRobust.total ||
      bRobust.angleUsable - aRobust.angleUsable ||
      bRobust.speedUsable - aRobust.speedUsable ||
      b.score - a.score ||
      a.launchSpeed - b.launchSpeed ||
      a.elapsed - b.elapsed ||
      a.arrivalSpeed - b.arrivalSpeed
    );
  });
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

  sortWinners(level, winners);

  return winners[0];
}

function withPreviewLevel(levelIndex) {
  return html
    .replace(/levelIndex:\s*\d+,/, `levelIndex: ${levelIndex},`)
    .replace(/const PREDICTION_TIME_RATIO = [^;]+;/, `const PREDICTION_TIME_RATIO = ${SCREENSHOT_PREDICTION_TIME_RATIO};`);
}

function worldToViewport(point, state, box) {
  return {
    x: box.x + (point.x / state.view.width) * box.width,
    y: box.y + (point.y / state.view.height) * box.height,
  };
}

async function renderSolutionScreenshots(solutions) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  for (const solution of solutions) {
    console.log(`Rendering mission ${solution.level}/${solutions.length}: ${solution.name}`);
    await page.setContent(withPreviewLevel(solution.level - 1), { waitUntil: "load" });
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      try {
        localStorage.removeItem("gravity-sling-high-scores-v1");
      } catch {
        // Ignore private-storage failures in screenshot generation.
      }
    });
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await page.waitForTimeout(100);

    const state = JSON.parse(await page.evaluate(() => window.render_game_to_text()));
    const box = await page.locator("canvas").boundingBox();
    if (!box) throw new Error("Canvas not found while rendering solution screenshot.");

    const start = worldToViewport(state.launch, state, box);
    const end = worldToViewport(solution.drag, state, box);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 12 });
    await page.waitForTimeout(180);

    const screenshotPath = path.join(screenshotDir, `level-${String(solution.level).padStart(2, "0")}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });

    await page.mouse.up();
    const replay = JSON.parse(await page.evaluate((ms) => window.advanceTime(ms), (TIME_LIMIT + 1) * 1000));
    solution.screenshot = path.relative(outDir, screenshotPath).replaceAll(path.sep, "/");
    solution.browserReplay = {
      mode: replay.mode,
      outcome: replay.lastOutcome,
      elapsed: replay.elapsed,
      speed: replay.speed,
      score: replay.score.level,
      atmosphere: replay.atmosphere,
      heat: replay.heat,
    };
    if (solution.browserReplay.outcome !== "target_reached") {
      throw new Error(`Browser replay failed for mission ${solution.level}: ${solution.name} (${solution.browserReplay.outcome})`);
    }
  }

  await browser.close();
  if (errors.length) {
    throw new Error(`Browser errors while rendering solution screenshots:\n${errors.join("\n")}`);
  }
}

function fmt(value, digits = 1) {
  return Number(value).toFixed(digits);
}

function directionFromDrag(solution) {
  const dx = solution.drag.x - solution.launch.x;
  const dy = solution.drag.y - solution.launch.y;
  const xWord = dx >= 0 ? "right" : "left";
  const yWord = dy >= 0 ? "down" : "up";
  return `${fmt(Math.abs(dx))} px ${xWord}, ${fmt(Math.abs(dy))} px ${yWord}`;
}

function writeOutputs(solutions) {
  const generatedAt = new Date().toISOString();
  const json = {
    generatedAt,
    source: "gravity_sling.html",
    method: "Deterministic physics search ranked by the in-game score formula; screenshots show the aiming drag for the chosen solution.",
    constants: {
      world: WORLD,
      shipRadius: SHIP_RADIUS,
      maxLaunchPull: MAX_LAUNCH_PULL,
      maxDrag: MAX_DRAG,
      launchPower: LAUNCH_POWER,
      scoreBestPoints: SCORE_BEST_POINTS,
      scoreFullPowerPoints: SCORE_FULL_POWER_POINTS,
      scoreBestLaunchSpeeds: SCORE_BEST_LAUNCH_SPEEDS,
      launchDeadZoneRatio: LAUNCH_DEAD_ZONE_RATIO,
      minLaunchRatio: MIN_LAUNCH_RATIO,
      timeLimit: TIME_LIMIT,
      sourcePredictionTimeRatio: SOURCE_PREDICTION_TIME_RATIO,
      screenshotPredictionTimeRatio: SCREENSHOT_PREDICTION_TIME_RATIO,
      gravityScale: GRAVITY_SCALE,
      heatLimit: HEAT_LIMIT,
      sunHeatGainRate: SUN_HEAT_GAIN_RATE,
      heatCoolRate: HEAT_COOL_RATE,
      shadowCoolRate: SHADOW_COOL_RATE,
    },
    solutions,
  };

  fs.writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`);

  const lines = [
    "# Gravitas Optimal Solutions",
    "",
    `Generated from \`gravity_sling.html\` at \`${generatedAt}\`.`,
    "",
    "The solver ranks winning shots by the same score formula as the game: the logged best launch speed for each mission is worth 100 points, a 100% launch is worth 10 points, and intermediate launch speeds are linearly scaled between those anchors.",
    "",
    `Screenshot prediction ratio: \`${SCREENSHOT_PREDICTION_TIME_RATIO}\` (source game ratio: \`${SOURCE_PREDICTION_TIME_RATIO}\`).`,
    "",
  ];

  for (const solution of solutions) {
    lines.push(
      `## Mission ${solution.level}: ${solution.name}`,
      "",
      `![Mission ${solution.level} solution](${solution.screenshot})`,
      "",
      `- Score: \`${solution.score}\``,
      `- Drag handle: \`x ${fmt(solution.drag.x)}, y ${fmt(solution.drag.y)}\``,
      `- From launch: ${directionFromDrag(solution)} (${solution.powerPercent}% power)`,
      `- Launch point: \`x ${fmt(solution.launch.x)}, y ${fmt(solution.launch.y)}\``,
      `- Pull vector: \`x ${fmt(solution.pull.x)}, y ${fmt(solution.pull.y)}\``,
      `- Launch speed: \`${fmt(solution.launchSpeed)}\``,
      `- Arrival: \`${solution.outcome}\` at \`${fmt(solution.elapsed, 2)}s\`, speed \`${fmt(solution.arrivalSpeed)}\``,
      `- Atmosphere time: \`${fmt(solution.atmosphereTime, 2)}s\`; max strength \`${fmt(solution.maxAtmosphereStrength, 3)}\``,
      `- Heat: peak \`${fmt((solution.maxHeat || 0) * 100, 0)}%\`; exposed \`${fmt(solution.heatTime || 0, 2)}s\`; shadow \`${fmt(solution.shadowTime || 0, 2)}s\``,
      `- Browser replay: \`${solution.browserReplay.outcome}\`, score \`${solution.browserReplay.score}\`, speed \`${fmt(solution.browserReplay.speed)}\``,
      "",
    );
  }

  fs.writeFileSync(markdownPath, `${lines.join("\n")}\n`);
}

function parseRequestedLevels(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const levels = new Set();
  for (const part of trimmed.split(",")) {
    const match = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!match) throw new Error(`Invalid SOLUTION_LEVELS entry: ${part}`);
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    if (start < 1 || end < start) throw new Error(`Invalid SOLUTION_LEVELS range: ${part}`);
    for (let level = start; level <= end; level += 1) levels.add(level);
  }
  return levels;
}

function mergeRequestedSolutions(solvedSolutions) {
  if (!REQUESTED_LEVELS) return solvedSolutions;
  if (!fs.existsSync(jsonPath)) {
    throw new Error("Targeted logging requires an existing solutions.json to merge with.");
  }
  const previous = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const previousByLevel = new Map(previous.solutions.map((solution) => [solution.level, solution]));
  const solvedByLevel = new Map(solvedSolutions.map((solution) => [solution.level, solution]));
  return levels.map((level, index) => {
    const levelNumber = index + 1;
    if (solvedByLevel.has(levelNumber)) return solvedByLevel.get(levelNumber);
    if (previousByLevel.has(levelNumber)) return previousByLevel.get(levelNumber);
    throw new Error(`Missing solution for mission ${levelNumber}: ${level.name}`);
  });
}

fs.mkdirSync(screenshotDir, { recursive: true });

const levelEntries = levels
  .map((level, index) => ({ level, index }))
  .filter(({ index }) => !REQUESTED_LEVELS || REQUESTED_LEVELS.has(index + 1));

if (!levelEntries.length) {
  throw new Error("No missions selected for solution logging.");
}

const solvedSolutions = levelEntries.map(({ level, index }) => {
  console.log(`Solving mission ${index + 1}/${levels.length}: ${level.name}`);
  return findBestSolution(level, index);
});

await renderSolutionScreenshots(solvedSolutions);
writeOutputs(mergeRequestedSolutions(solvedSolutions));

console.log(`Wrote ${markdownPath}`);
console.log(`Wrote ${jsonPath}`);
