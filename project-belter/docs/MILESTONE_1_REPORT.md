# Milestone 1 acceptance report

## Scope decision

This implementation contains Milestone 0 and Milestone 1 only. The boundary is deliberate: the first review unit establishes repository structure, deterministic flight, renderer separation, mobile camera behavior, interchangeable controls, asteroid drift, and relative-velocity collisions. Targeting, mining, station economy, and progression remain absent.

## Acceptance mapping

| Requirement | Status | Evidence |
|---|---:|---|
| Vite, Phaser, and TypeScript project | Complete | `package.json`, `vite.config.ts`, `src/main.ts` |
| Canvas plus DOM overlay | Complete | `GameApp`, `FlightScene`, `HudRoot` |
| Portrait/landscape responsive shell | Complete | safe-area CSS and two Playwright viewport projects |
| Asset manifest and placeholder visuals | Complete | `src/assets/manifest.ts` and procedural Phaser views |
| Simulation clock and entity store | Complete | `SimulationClock`, `EntityStore`, unit tests |
| Debug overlay | Complete | `F3`/`?debug`, frame and simulation telemetry |
| Simulation independent of rendering | Complete | systems and entities contain no Phaser dependency |
| Newtonian thrust and rotation | Complete | `FlightSystem` fixed-step integration |
| No routine drag | Complete | unit and browser coast tests |
| Cargo mass changes acceleration | Complete | force/mass rule and unit acceptance test |
| Fuel use | Complete | forward, reverse, and rotational fuel rates; coast test |
| Portrait ship anchor near 74% | Complete | camera telemetry assertions and screenshot review |
| World rotates with ship heading | Complete | inverse camera rotation and browser assertion |
| Limited forward view and dynamic zoom | Complete | bounded camera look-ahead and smoothed zoom |
| Keyboard adapter | Complete | keyboard controller and desktop browser test |
| Virtual joystick adapter | Complete | touch/pointer controller and mobile browser test |
| Calibrated tilt adapter | Complete | permission, normalization, dead zone, smoothing, calibration |
| Sensor failure falls back to joystick | Complete | mobile browser test |
| Seeded drifting asteroids | Complete | 42 deterministic entities and field test |
| Clear launch perimeter | Complete | rejection placement and clearance unit test |
| Circle collisions | Complete | collision system and contact rearm logic |
| Relative-speed damage bands | Complete | low/high impact unit tests and HUD event feedback |

## Automated verification

Final verification commands:

```text
npm run check
npm run test:e2e
```

Results:

- TypeScript: passed;
- ESLint: passed;
- Vitest: 5 files, 14 tests passed;
- production build: passed;
- Playwright: 5 applicable tests passed across mobile portrait and desktop landscape; 3 project-inapplicable cases skipped;
- browser page errors: none in the tested startup paths.

The production build contains approximately 11 kB CSS and 334 kB gzip JavaScript. Vite reports its standard large uncompressed chunk warning because Phaser is in the initial bundle.

## Visual QA

Reviewed states:

- mobile portrait boot with joystick;
- desktop landscape boot with keyboard;
- fixed ship anchor and forward clearance;
- compact top-edge instrumentation;
- station launch placement;
- asteroid readability and station launch-zone clearance;
- joystick and pause controls at the lower safe areas.

Evidence:

- [`../artifacts/screenshots/mobile-portrait-flight.png`](../artifacts/screenshots/mobile-portrait-flight.png)
- [`../artifacts/screenshots/desktop-landscape-flight.png`](../artifacts/screenshots/desktop-landscape-flight.png)

The first screenshot pass exposed two issues that were corrected before this report:

1. camera scroll was incorrectly divided by zoom, placing the ship outside the intended anchor;
2. a generated asteroid could overlap the station launch perimeter.

Regression coverage now protects the camera telemetry bounds and deterministic asteroid clearance.

## Manual device work still required

Browser automation cannot validate physical phone ergonomics. Before accepting tilt controls for a public mobile build, test on representative iOS and Android devices for:

- permission prompts and denial recovery;
- neutral calibration posture;
- sensor noise and smoothing comfort;
- portrait/landscape axis normalization;
- orientation-change pause and recalibration;
- notches, browser bars, and safe-area insets;
- heat, battery use, and sustained frame rate.

## Technical debt intentionally carried forward

- Collision broad phase is linear over 42 asteroids. Add a uniform grid when debris and drone counts justify it.
- Art is procedural placeholder geometry; there is no audio or haptic layer yet.
- Phaser remains in the initial JavaScript chunk. Later load-time work can split boot/UI code and audit asset packaging.
- Settings persist, while career and expedition saves wait for the station/economy milestone.
- The Playwright harness executes the production bundle as an inline document because this build environment blocks loopback browser navigation. It still runs the built JavaScript and CSS, input events, canvas rendering, and DOM interface.

## Next milestone boundary

Milestone 2 should add only targeting and navigation:

- generous pointer/touch asteroid selection;
- selected-target simulation state;
- outline, distance, relative speed, resource estimate placeholder, and off-screen marker;
- projected closest approach and velocity cues;
- hold-to-match and optional bounded approach assistance using real thrusters and fuel;
- direct input override and tests proving no hidden velocity mutation.

Mining, cargo extraction, docking, market transactions, upgrades, and progression should remain outside that review unit.
