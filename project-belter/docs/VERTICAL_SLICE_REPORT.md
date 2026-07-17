# Project Belter — first playable vertical-slice report

## Scope delivered

The build completes Milestones 2–5 on top of the Milestone 1 flight sandbox and joins them into one uninterrupted route:

1. launch from Miner's Rest;
2. fly toward the marked asteroid field;
3. select M-12 Kestrel Rock;
4. approach and match velocity manually or through bounded assistance;
5. stabilize until drones launch automatically;
6. watch drones travel, extract, return, and transfer cargo;
7. recall all drones;
8. select the station, return, and dock automatically at low relative speed;
9. sell the returned resources;
10. buy and install a visible engine upgrade;
11. launch with changed thrust and mass;
12. reload and reconstruct credits, completion state, and installed modules.

The vertical slice excludes combat, multiplayer, multiple markets, a full Solar System, complex contracts, crew systems, and live-service features.

## Acceptance mapping

### Targeting and navigation

- Pointer and touch selection use a generous world-space hit radius.
- The selected-target panel reports surface distance, relative speed, composition estimate, remaining yield, and projected closest approach.
- An off-screen edge marker shows target direction and range.
- Approach assistance and velocity matching output ordinary flight actions. They do not write velocity directly.
- Strong manual steering or thrust disengages assistance.
- Unit integration verifies a full physical rendezvous from the station without teleportation.

### Mining

- The arming gate uses 70 m surface distance, 6.5 m/s relative speed, and 0.6 seconds of stability.
- Drone launch also requires cargo space, available operational drones, and remaining asteroid yield.
- Drones are simulation entities with visible sprites and independent launch, transit, extraction, pause, and return states.
- Cargo is credited only when a drone reaches the ship.
- Mild drift pauses extraction; larger distance, dangerous relative speed, target change, or explicit recall returns drones.
- Periodic mining debris inherits asteroid motion, has finite lifetime, displays a trail, and damages the ship according to relative impact velocity.

### Station and economy

- The station is targetable and works with the same relative-motion assistance model.
- Automatic docking requires all drones aboard, low relative speed, station proximity, and continuous stabilization.
- The station DOM interface provides market sale, ship servicing, shipyard purchase, credits, and launch.
- The training asteroid's first useful haul funds the initial engine upgrade in one successful run.

### Progression

- Three modules are purchasable: engine pods, retro package, and cargo saddles.
- Each module has mass and handling trade-offs.
- Installed modules add visible hardpoint sprites to the ship.
- The Kestrel engine changes forward thrust, dry mass, acceleration, and fuel consumption.
- Career state is versioned and reconstructed after page reload.

### Presentation

- Procedural placeholder silhouettes were replaced with optimized sprite graphics for the ship, station, eight asteroid variants, four drones, debris fragments, and three module types.
- The DOM HUD was redesigned as restrained industrial instrumentation with cyan/amber state language.
- Portrait, landscape, desktop, safe-area, pause, tilt, joystick, and station layouts remain responsive.

## Automated verification

Current unit and integration coverage includes:

- fixed-step clock behavior;
- Newtonian acceleration, mass effects, fuel use, and momentum preservation;
- seeded asteroid placement and station clearance;
- relative-speed collision severity;
- tilt dead-zone, calibration, smoothing, and inversion;
- mining eligibility and stabilization timing;
- cargo transfer only after drone return;
- extraction pause and emergency recall;
- complete assisted rendezvous, mining, recall, and station return without debug teleportation;
- market transactions and module stat aggregation;
- complete launch-to-upgrade state flow and loadout reconstruction.

Browser QA covers mobile portrait and desktop landscape:

- production-bundle boot without runtime errors;
- station interface readability;
- pointer asteroid selection;
- portrait and landscape camera anchors;
- keyboard and joystick momentum after release;
- motion-sensor failure fallback;
- visible deployed-drone state before cargo credit;
- docking, sale, purchase, installed handling change, and reload persistence.

Run the complete record with:

```bash
npm run verify
```

Final verification result:

- TypeScript project checks passed.
- ESLint passed.
- 21 Vitest unit and integration tests passed across nine files.
- Two complete Playwright browser journeys passed: mobile portrait and desktop landscape.
- Two project-inapplicable mirrored cases were skipped by design.
- No page-level runtime errors were reported.
- The production Vite build and an additional self-contained HTML boot smoke test passed.

## Representative evidence

- `artifacts/screenshots/mobile-portrait-station.png`
- `artifacts/screenshots/mobile-portrait-target-lock.png`
- `artifacts/screenshots/desktop-drones-deployed.png`
- `artifacts/screenshots/desktop-mining.png`
- `artifacts/screenshots/desktop-upgrade-installed.png`
- `artifacts/screenshots/desktop-upgraded-flight.png`

## Remaining device-specific QA

Physical iOS and Android testing is still required for motion-permission wording, calibration posture, sensor noise, browser bars, orientation changes, haptics, heat, battery use, and sustained debris-heavy performance. These do not block the deterministic browser vertical slice.

## Known technical constraint

Phaser accounts for most of the approximately 347 kB gzip JavaScript entry bundle, which triggers Vite's default uncompressed chunk-size warning. The build succeeds. Code splitting and PWA delivery belong to a later performance and packaging pass.
