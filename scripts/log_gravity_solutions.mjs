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
const MAX_LAUNCH_SPEED = MAX_DRAG * LAUNCH_POWER;
const FIXED_DT = numberConst("FIXED_DT");
const TIME_LIMIT = numberConst("TIME_LIMIT");
const FLY_MARGIN = numberConst("FLY_MARGIN");
const GRAVITY_SCALE = numberConst("GRAVITY_SCALE");
const SOURCE_PREDICTION_TIME_RATIO = numberConst("PREDICTION_TIME_RATIO");
const SCREENSHOT_PREDICTION_TIME_RATIO = process.env.GRAVITY_SOLUTION_PREDICTION_RATIO === undefined
  ? SOURCE_PREDICTION_TIME_RATIO
  : Number(process.env.GRAVITY_SOLUTION_PREDICTION_RATIO);
const MIN_LAUNCH_PULL = 12;

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

function checkProbeOutcome(probe, level, elapsed) {
  for (const planet of level.planets) {
    if (length(probe.x - planet.x, probe.y - planet.y) <= SHIP_RADIUS + planet.r) {
      return "planet_collision";
    }
    if (planet.hotRadius && length(probe.x - planet.x, probe.y - planet.y) <= SHIP_RADIUS + planet.hotRadius) {
      return "hot_zone";
    }
  }

  for (const hazard of level.hazards || []) {
    if (length(probe.x - hazard.x, probe.y - hazard.y) <= SHIP_RADIUS + hazard.r) {
      return "hazard_collision";
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

function scoreForLaunchSpeed(launchSpeed, levelIndex) {
  const speedRatio = clamp(launchSpeed / MAX_LAUNCH_SPEED, 0, 1);
  const efficiency = Math.pow(1 - speedRatio, 1.35);
  const levelBonus = (levelIndex + 1) * 100;
  return Math.round(levelBonus + 1200 * efficiency);
}

function simulate(level, pullX, pullY) {
  const probe = {
    x: level.launch.x,
    y: level.launch.y,
    vx: pullX * LAUNCH_POWER,
    vy: pullY * LAUNCH_POWER,
  };
  let atmosphereTime = 0;
  let maxAtmosphereStrength = 0;
  let minTargetDistance = Infinity;
  const steps = Math.ceil(TIME_LIMIT / FIXED_DT);

  for (let i = 0; i < steps; i += 1) {
    const atmosphere = applyGravity(probe, level, FIXED_DT);
    atmosphereTime += atmosphere.atmosphereTime;
    maxAtmosphereStrength = Math.max(maxAtmosphereStrength, atmosphere.maxAtmosphereStrength);
    minTargetDistance = Math.min(minTargetDistance, length(probe.x - level.target.x, probe.y - level.target.y));

    const outcome = checkProbeOutcome(probe, level, i * FIXED_DT);
    if (outcome) {
      return {
        outcome,
        elapsed: i * FIXED_DT,
        x: probe.x,
        y: probe.y,
        arrivalSpeed: length(probe.vx, probe.vy),
        atmosphereTime,
        maxAtmosphereStrength,
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
    minTargetDistance,
  };
}

function solutionRecord(level, levelIndex, pullX, pullY, result) {
  const radius = length(pullX, pullY);
  const launchSpeed = radius * LAUNCH_POWER;
  const drag = {
    x: level.launch.x - pullX,
    y: level.launch.y - pullY,
  };
  return {
    level: levelIndex + 1,
    name: level.name,
    score: scoreForLaunchSpeed(launchSpeed, levelIndex),
    powerPercent: Math.round(radius / MAX_DRAG * 100),
    radius,
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
  const sorted = [...winners].sort((a, b) => b.score - a.score);
  return sorted.slice(0, 12).map((winner) => ({
    radiusMin: Math.max(MIN_LAUNCH_PULL, winner.radius - 5),
    radiusMax: Math.min(MAX_DRAG, winner.radius + 4),
    angleMin: winner.angleDeg - 8,
    angleMax: winner.angleDeg + 8,
  }));
}

function scan(level, levelIndex, ranges, radiusStep, angleStep) {
  const winners = [];
  for (const range of ranges) {
    const radiusMin = Math.max(MIN_LAUNCH_PULL, range.radiusMin);
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
      maxDrag: MAX_DRAG,
      launchPower: LAUNCH_POWER,
      timeLimit: TIME_LIMIT,
      sourcePredictionTimeRatio: SOURCE_PREDICTION_TIME_RATIO,
      screenshotPredictionTimeRatio: SCREENSHOT_PREDICTION_TIME_RATIO,
      gravityScale: GRAVITY_SCALE,
    },
    solutions,
  };

  fs.writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`);

  const lines = [
    "# Gravity Sling Optimal Solutions",
    "",
    `Generated from \`gravity_sling.html\` at \`${generatedAt}\`.`,
    "",
    "The solver ranks winning shots by the same score formula as the game, so lower launch speed wins when a route still reaches the target. Screenshots show the aiming state for the logged drag point.",
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
      `- Browser replay: \`${solution.browserReplay.outcome}\`, score \`${solution.browserReplay.score}\`, speed \`${fmt(solution.browserReplay.speed)}\``,
      "",
    );
  }

  fs.writeFileSync(markdownPath, `${lines.join("\n")}\n`);
}

fs.mkdirSync(screenshotDir, { recursive: true });

const solutions = levels.map((level, index) => {
  console.log(`Solving mission ${index + 1}/${levels.length}: ${level.name}`);
  return findBestSolution(level, index);
});

await renderSolutionScreenshots(solutions);
writeOutputs(solutions);

console.log(`Wrote ${markdownPath}`);
console.log(`Wrote ${jsonPath}`);
