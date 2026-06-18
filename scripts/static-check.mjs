import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const coreHtmlFiles = [
  "index.html",
  "SolarExplorer.html",
  "solarexplorer_deutsch.html",
  "memory_deutsch.html"
];
const optionalGameFiles = [
  "gravity_sling.html"
];
const htmlFiles = [
  ...coreHtmlFiles,
  ...optionalGameFiles.filter((file) => fs.existsSync(path.join(root, file)))
];

const requiredFiles = [
  ...coreHtmlFiles,
  "scripts/explorer-runtime.js",
  "IMAGE_CREDITS.md"
];

const failures = [];

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function fail(message) {
  failures.push(message);
}

function isLocalReference(value) {
  return value &&
    !value.includes("${") &&
    !value.startsWith("#") &&
    !value.startsWith("http://") &&
    !value.startsWith("https://") &&
    !value.startsWith("data:") &&
    !value.startsWith("mailto:");
}

function checkLocalReference(file, value) {
  if (!isLocalReference(value)) return;
  const cleanValue = value.split("#")[0].split("?")[0];
  if (!cleanValue) return;
  const target = path.normalize(path.join(path.dirname(file), cleanValue));
  if (!exists(target)) {
    fail(`${file} references missing local file: ${value}`);
  }
}

for (const file of requiredFiles) {
  if (!exists(file)) {
    fail(`Missing required file: ${file}`);
  }
}

for (const file of htmlFiles) {
  if (!exists(file)) continue;
  const html = fs.readFileSync(path.join(root, file), "utf8");

  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      new Function(match[1]);
    } catch (error) {
      fail(`${file} contains invalid inline script syntax: ${error.message}`);
    }
  }

  for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) {
    checkLocalReference(file, match[1]);
  }

  for (const match of html.matchAll(/["'](images\/[^"']+)["']/g)) {
    checkLocalReference(file, match[1]);
  }
}

const runtime = exists("scripts/explorer-runtime.js")
  ? fs.readFileSync(path.join(root, "scripts/explorer-runtime.js"), "utf8")
  : "";
const germanExplorer = exists("solarexplorer_deutsch.html")
  ? fs.readFileSync(path.join(root, "solarexplorer_deutsch.html"), "utf8")
  : "";
const englishExplorer = exists("SolarExplorer.html")
  ? fs.readFileSync(path.join(root, "SolarExplorer.html"), "utf8")
  : "";
const memory = exists("memory_deutsch.html")
  ? fs.readFileSync(path.join(root, "memory_deutsch.html"), "utf8")
  : "";
const gravitySling = exists("gravity_sling.html")
  ? fs.readFileSync(path.join(root, "gravity_sling.html"), "utf8")
  : "";
const germanTextFiles = {
  "index.html": exists("index.html") ? fs.readFileSync(path.join(root, "index.html"), "utf8") : "",
  "memory_deutsch.html": memory,
  "solarexplorer_deutsch.html": germanExplorer
};
const fallbackSpellings = ["Zurueck", "fuer", "spaeter", "Himmelskoerper", "raeume", "Waehle"];

if (!runtime.includes("window.render_game_to_text")) {
  fail("Explorer runtime does not expose window.render_game_to_text.");
}

if (!runtime.includes("pagehide") || !runtime.includes("clearSavedVisitedBodies")) {
  fail("Explorer runtime does not reset passport progress when leaving.");
}

if (!germanExplorer.includes("scripts/explorer-runtime.js") || !englishExplorer.includes("scripts/explorer-runtime.js")) {
  fail("Both explorer pages must include scripts/explorer-runtime.js.");
}

if ((memory.match(/id: "/g) || []).length !== 15) {
  fail("Memory sourceBodies should contain exactly 15 body entries.");
}

if (!memory.includes("window.render_game_to_text")) {
  fail("Memory game does not expose window.render_game_to_text.");
}

if (gravitySling) {
  const index = germanTextFiles["index.html"];
  if (!index.includes('href="gravity_sling.html"') && !index.includes("href='gravity_sling.html'")) {
    fail("Index page must link Minispiel 3 to gravity_sling.html.");
  }

  if (!gravitySling.includes("window.render_game_to_text")) {
    fail("Gravity Sling game does not expose window.render_game_to_text.");
  }

  if (!gravitySling.includes("window.advanceTime")) {
    fail("Gravity Sling game does not expose window.advanceTime.");
  }
}

for (const [file, contents] of Object.entries(germanTextFiles)) {
  for (const fallback of fallbackSpellings) {
    if (contents.includes(fallback)) {
      fail(`${file} still contains German fallback spelling: ${fallback}`);
    }
  }
}

if (fs.existsSync(path.join(root, ".DS_Store")) || fs.existsSync(path.join(root, "images/.DS_Store"))) {
  fail("Remove .DS_Store files before committing.");
}

if (failures.length) {
  console.error("Static check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Static check passed.");
