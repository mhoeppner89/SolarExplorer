# Project Belter — first playable vertical slice

Project Belter is a portrait-first 2D space-mining game built around Newtonian movement and relative velocity. This repository implements the first complete station-to-station loop:

1. launch from Miner's Rest;
2. select and rendezvous with a moving asteroid;
3. match relative velocity;
4. stabilize inside the mining envelope;
5. watch mining drones launch, extract, return, and transfer cargo;
6. recall the drones;
7. return and dock;
8. sell the haul;
9. buy and install a visible ship module;
10. launch with changed handling;
11. reload and retain career progression.

Phaser owns rendering, cameras, effects, asset loading, and scene lifecycle. A custom fixed-step simulation owns flight, target state, bounded assistance, mining, drones, debris, collisions, docking, and saveable domain state. The HUD, station, settings, prompts, and mobile controls are DOM overlays.

The full implementation specification is in [`docs/PROJECT_BELTER_GAME_SPEC.md`](docs/PROJECT_BELTER_GAME_SPEC.md).

## Included systems

- Phaser 3, TypeScript, Vite, ESLint, Vitest, and Playwright.
- Deterministic 60 Hz simulation outside Phaser scenes.
- Newtonian forward, reverse, and lateral thrust with no routine drag.
- Cargo and installed-module mass affecting acceleration and braking.
- Keyboard, virtual joystick, and calibrated phone-tilt adapters behind one action interface.
- Portrait camera anchor near 74% viewport height, ship-relative world rotation, forward look-ahead, and restrained dynamic zoom.
- Seeded independently moving asteroid field with three material families, four silhouettes per family, five explicit size classes from 1× through 25×, and four deposit tiers independent of size.
- Alpha-fitted in-world collision contours are drawn over each sprite and distinguish very-small through very-large cover geometry before contact.
- Very-large bodies use dedicated 627 px asteroid art for all three material families and four silhouettes.
- Asteroid-to-asteroid collisions with momentum exchange and rare impact breakups into capped, same-family fragments that preserve most of the deposit.
- Touch/pointer target selection, target telemetry, projected approach data, target marker, and mining ring.
- Bounded approach assistance that spends fuel and uses the ship's real thrusters. Direct input overrides it.
- Automatic mining after the selected asteroid remains within 70 m of its surface and below 6.5 m/s relative speed for 0.6 seconds.
- Visible drones with launch, transit, extraction, return, and cargo-transfer states. Cargo is credited only on return.
- Slow mining debris that inherits asteroid motion and cannot disturb a ship matched to the mining target.
- Two physical stations with automatic low-speed docking after all drones return.
- Sector autopilot with predictive asteroid avoidance, smoothed A* routes, and continuous replanning.
- Market sale, servicing, credits, four purchasable modules, visible hardpoint sprites, and handling trade-offs.
- Versioned local career persistence after docking and station transactions.
- Clean generated ship, station, asteroid, drone, debris, and module sprites that remain readable while zoomed out.

Combat, multiplayer, multiple markets, complex contracts, and a full Solar System remain outside this vertical slice.

## Run locally

Node.js 22.12 or newer is required.

```bash
npm ci
npm run dev
```

Open the URL printed by Vite. Production commands:

```bash
npm run build
npm run preview
npm run build:standalone
```

`npm run build:standalone` writes a self-contained HTML build to `dist/project-belter-vertical-slice-standalone.html` with all sprites, CSS, and JavaScript embedded.

## Controls

### Keyboard

- `W` / `ArrowUp`: forward thrust
- `S` / `ArrowDown`: reverse thrust
- `A` / `D` or left / right arrows: rotate
- `Q` / `E`: lateral thrust left / right without rotating
- Mouse click: select asteroid or station
- `F`: contextual action or approach assist
- `R`: recall drones
- `Esc`: pause
- `C`: recalibrate tilt
- `F3`: debug overlay

Releasing thrust stops acceleration and preserves momentum.

### Mobile joystick

Drag upward or downward for forward or reverse thrust and sideways to rotate. Hold the paired arrow buttons for lateral thrust. Releasing a control stops acceleration while the ship continues coasting.

### Phone tilt

Open **Pause → Control Adapter → Phone Tilt**. Roll controls rotation. Pitch relative to the calibrated neutral position controls forward or reverse thrust. Permission is requested only from the explicit button gesture. Denied, unavailable, or non-reporting sensors activate the joystick fallback.

### Context controls

- Tap an asteroid to lock it.
- `ASSIST` uses ordinary thrusters to approach the selected target.
- The action changes to `RECALL` while drones are deployed.
- `NAV` opens a sector map with stations and asteroid fields.
- Selecting a station or asteroid field engages autopilot immediately.
- Autopilot plots a short route around moving asteroids, replans as they drift, and uses normal ship thrusters. Any manual flight input disengages it.
- Docking completes automatically after entering the station zone below the speed threshold.

## First-run route

The marked target **M-12 Kestrel Rock** is placed near the station and contains enough industrial metals to purchase the first engine upgrade after one drone cycle. The active-procedure prompt tracks the uninterrupted loop from launch through sale and installation.

The engine upgrade increases main thrust and fuel use while adding mass. The retro package improves braking, and the cargo saddles increase capacity while adding mass and reducing rotational response. Each module adds visible components to the ship.

## Persistence

Career state is saved under the versioned key `project-belter.career.v1`. The save contains credits, owned and installed modules, completion state, career statistics, and a timestamp. Settings use a separate versioned key. Phaser display objects are never serialized.

Autosave points include docking, market sales, module purchases, servicing, visibility loss, and page unload.

## Verification

```bash
npm run check       # typecheck, lint, unit/integration tests, production build
npm run test:e2e    # mobile portrait and desktop landscape browser QA
npm run verify      # complete verification sequence
```

The automated suite covers:

- fixed-step integration, thrust, mass, fuel, and momentum;
- relative-speed collision bands;
- seeded asteroid placement, size-independent deposit tiers, asteroid collisions, and capped fragmentation;
- tilt calibration and dead zones;
- mining eligibility, stabilization, pause, recall, cargo-on-return, and depletion behavior;
- full assisted rendezvous, mining, return, and docking without test teleportation;
- economy transactions, module aggregation, and versioned progression reconstruction;
- mobile/desktop boot, pointer selection, camera anchor, keyboard and joystick coast behavior, tilt fallback, complete sale/upgrade flow, and reload persistence.

Representative screenshots are in [`artifacts/screenshots/`](artifacts/screenshots/). The acceptance record is in [`docs/VERTICAL_SLICE_REPORT.md`](docs/VERTICAL_SLICE_REPORT.md), and the module boundaries are described in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Key paths

```text
src/app/                  application composition and lifecycle
src/data/                 resource and module definitions
src/game/config/          centralized tuning
src/game/input/           interchangeable input adapters
src/game/simulation/      authoritative deterministic state and systems
src/game/rendering/       disposable Phaser vector views and indicators
src/game/scenes/          thin Phaser lifecycle adapters
src/progression/          career transactions and loadout aggregation
src/save/                 versioned local persistence
src/ui/                   DOM HUD, station, settings, and responsive CSS
public/assets/sprites/    optimized generated game sprites
tests/unit/               deterministic unit and integration tests
tests/e2e/                production-bundle browser tests
```

## Current constraints

- The Phaser-inclusive JavaScript bundle is about 347 kB gzip and triggers Vite's default uncompressed chunk warning. Runtime code splitting is deferred.
- Collision checks remain direct at this entity count. A spatial grid is appropriate when later builds increase debris density.
- Audio, haptics, PWA packaging, complex contracts, and real-device tilt ergonomics remain later work.
- Playwright embeds the production bundle and sprite data into the test page because this execution environment blocks all browser URL navigation. The shipped web build uses normal relative asset URLs and `localStorage`.
