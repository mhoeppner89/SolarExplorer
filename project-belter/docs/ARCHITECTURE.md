# Project Belter architecture — first playable vertical slice

## Non-negotiable boundary

The authoritative game state is plain TypeScript data and deterministic systems. Phaser never owns gameplay rules.

```text
browser events / sensors
          ↓
     InputManager
          ↓ FlightActionState
  GameSimulation at 60 Hz  ← installed module data
          ↓ snapshots + typed events
    ┌───────────────┴───────────────┐
    ↓                               ↓
Phaser views, camera, FX       DOM HUD and station UI
                                    ↓
                         career transactions / saves
```

Phaser owns sprites, camera transforms, scene lifecycle, asset loading, and transient effects. DOM components own text-heavy interfaces and accessible controls. Career and settings persistence serialize domain data only.

## Application composition

`GameApp` creates and coordinates:

- `GameSimulation` — authoritative expedition state;
- `SimulationClock` — variable render time to fixed 60 Hz simulation steps;
- `InputManager` — one active physical adapter behind a shared action state;
- `FlightScene` — thin integration boundary between actions, simulation, views, and HUD;
- `HudRoot` — flight instrumentation, joystick, station interface, pause, settings, prompts, and contextual controls;
- `PlayerSettingsStore` — validated settings persistence;
- `SaveService` — versioned career persistence;
- `CareerState` and `ShipLoadout` — economy transactions and module stat aggregation.

`GameApp` also owns station-open and pause state. Both suspend all flight adapters, which prevents tilt or held keyboard input from leaking through overlays.

## Fixed-step simulation

`GameSimulation.step(deltaSeconds, actions)` is the normal expedition mutation entry point. Each step performs a stable sequence:

1. process edge-triggered actions such as assist, recall, and interaction;
2. derive bounded navigation assistance below direct input priority;
3. integrate ship forces, fuel, angular state, velocity, and position;
4. integrate asteroid drift and debris lifetime;
5. resolve asteroid-to-asteroid contacts and eligible fracture events;
6. update mining eligibility and every drone state machine;
7. resolve ship collisions against asteroids and debris using relative velocity;
8. update station docking eligibility and stabilization;
9. retain typed events for the scene and HUD to consume.

The render frame rate does not change these rules. `SimulationClock` accumulates elapsed time, issues fixed steps, and exposes interpolation alpha. Previous and current transforms are stored for smooth rendering. A catch-up limit prevents unbounded simulation bursts after tab suspension.

## Simulation entities

`EntityStore` owns plain entities:

- one player ship;
- two physical stations;
- asteroid entities;
- mining-drone entities;
- finite-lifetime debris entities.

Important domain fields include transforms, velocities, basic circle bounds, ship fuel and cargo, installed module IDs, asteroid material, fitted shape profile, size class, deposit tier, yield, stability and fragment generation, drone state and carried payload, and debris source metadata. Entity IDs remain stable references across systems and views.

Asteroid deposits use four availability tiers that are rolled independently from physical radius. Collision fracture keeps the material, resource type, and tier, retains most of the remaining yield, and transfers target lock to the largest child. Minimum parent size, two fragment generations, a short grace period, and an entity cap prevent runaway breakup chains.

Asteroid size classes use a 12 m baseline radius: very-small is 1×, small is 2×, medium is 5×, large is 10×, and very-large is 25×, with slight seeded variation outside five guaranteed reference bodies. Collision profiles are generated from 48 radial samples of each material, silhouette, and resolution-specific PNG alpha edge. Rendering draws that profile above the sprite, while impacts, mining distance, targeting, and drone attachment use the same rotated boundary. Very-large bodies select dedicated 627 px art; smaller classes retain the 256 px set. Fragment radius determines the child size class, so impacts naturally produce smaller cover pieces.

## Flight and module aggregation

The flight model uses internally consistent metres, seconds, radians, and tonnes:

- no routine linear drag;
- force divided by current mass determines acceleration;
- current mass includes dry mass, installed module mass, and cargo;
- forward, reverse, and rotational commands consume fuel;
- mild angular damping improves control readability;
- a very high safety clamp exists only for numerical protection.

`aggregateShipStats` starts from chassis values and applies installed module trade-offs. `GameSimulation.applyLoadout` writes the resulting dry mass, cargo capacity, thrust, rotational response, and fuel multiplier onto the authoritative ship. `ShipView` reads the installed IDs to show matching module sprites at named hardpoints.

## Input boundary

Keyboard, virtual joystick, and tilt adapters emit the same `FlightActionState`. The simulation sees actions, never browser events.

The action state includes:

- signed steering;
- forward and reverse thrust;
- approach-assist toggle;
- held velocity match;
- drone recall;
- contextual interaction;
- pause and calibration signals at the application boundary.

Direct steering or thrust above the tuned threshold immediately overrides and disengages approach assistance. Releasing a physical adapter zeros commands without editing velocity.

## Targeting and navigation

Pointer input is converted from screen coordinates to world coordinates by Phaser, then passed to `GameSimulation.selectTargetAt`. The simulation resolves generous circle hits against targetable asteroids and the station.

`NavigationSystem` derives assisted action frames rather than changing position or velocity. It:

- chooses a standoff point outside the target surface;
- derives a bounded desired approach velocity;
- compares desired and current velocity;
- rotates toward the required delta-velocity vector;
- selects main or reverse thrust when appropriate;
- applies ordinary thrust values that still consume fuel and depend on mass.

Approach assistance derives normal flight actions from the selected target. It never writes velocity directly. Sector navigation uses a dynamic A* grid with line-of-sight smoothing, expanded collision envelopes, short-horizon asteroid motion prediction, and regular replanning. Its waypoints feed the same physical flight controller. Direct steering or thrust cancels autopilot immediately. The target snapshot provides distance to surface, relative speed, closing speed, resource estimate, remaining yield, and projected closest approach. Phaser renders world cues and the DOM renders the compact summary, route, and off-screen marker.

## Mining and drones

`MiningSystem` is an explicit state machine with `idle`, `stabilizing`, `launching`, `mining`, `paused`, `recalling`, and `complete` presentation states.

The initial launch gate requires:

- a selected, non-depleted asteroid;
- at least one available drone;
- remaining cargo capacity;
- no extraction suppression;
- surface distance at or below 70 m;
- relative speed below 6.5 m/s;
- 0.6 continuous seconds inside that envelope.

Each `DroneEntity` independently transitions through launch delay, transit, extraction, pause, and return. Extraction reserves only a payload on the drone. Cargo enters the ship manifest when the returning drone reaches the ship. This preserves the design rule that a lost or stranded drone can lose its load.

Mild drift pauses extracting drones. Larger distance or dangerous relative speed requests recall. Mining periodically creates debris with inherited asteroid velocity plus an ejection vector. Debris uses the same relative-speed collision system as asteroids.

## Docking and station phase

A station is a normal target. Docking is eligible only when:

- the station is selected;
- all drones are aboard;
- the ship is inside the docking distance;
- relative speed is below the threshold;
- the hull remains operational.

The ship must remain eligible through the stabilization timer. Completion moves the simulation to `station`, clears flight actions, emits `DockingCompleted`, and lets `GameApp` open the DOM station interface.

Station transactions are outside the fixed-step expedition systems:

- market sale converts the ship cargo manifest into credits;
- service restores hull, fuel, and drones;
- module purchase validates price and ownership, updates career state, applies the loadout, and refreshes the UI;
- each transaction requests a save immediately.

## Rendering and disposable views

`BootScene` loads stable manifest keys. It accepts an optional embedded asset dictionary for self-contained builds and browser tests, while the normal web build uses relative sprite URLs.

`FlightScene` advances the clock, samples input, drains events, and updates `ViewRegistry`. Views mirror state but never write it:

- `ShipView` — base sprite, visible hardpoint modules, and thruster effects;
- `StationView` — station sprite, docking lights, and lock ring;
- `AsteroidView` — one generated sprite variant and selection treatment;
- `DroneView` — visible drone transit and payload indication;
- `DebrisView` — fragment sprite and danger trail;
- `NavigationView` — target line, mining ring, relative-motion and desired-velocity cues;
- `VelocityVectorView` — clamped ship velocity vector;
- `CameraRig` — ship anchor, inverse rotation, look-ahead, zoom, and shake.

View objects are created or destroyed when simulation entities appear or disappear. The renderer can therefore be replaced without rewriting gameplay state.

## DOM interface

`HudRoot` owns a single responsive overlay tree:

- compact hull, fuel, cargo, drone, credit, speed, and thrust instrumentation;
- selected-target and mining readiness panel;
- active-procedure prompt;
- off-screen target marker;
- joystick and contextual action cluster;
- pause and control settings;
- full station market, service, shipyard, and launch interface;
- transient impact, transfer, docking, and save feedback.

Safe-area CSS variables handle notches and mobile browser chrome. Portrait layout keeps the ship near 74% viewport height and limits persistent UI to the edges. The station interface becomes a scrollable single-column surface on small screens with a persistent launch control.

## Persistence

`CareerState` is separate from expedition state. The current save includes:

- schema version;
- credits;
- owned and installed module IDs;
- tutorial completion;
- career statistics;
- last-save timestamp.

`normalizeCareer` validates and migrates partial or stale objects to the current shape. `SaveService` uses `localStorage` under a versioned key. Saves occur after docking and every station transaction, on visibility loss, and before unload. Phaser objects, live drones, and transient effects are excluded.

## Testing boundaries

Vitest exercises deterministic systems without Phaser, including a complete assisted expedition from launch through automatic docking without debug teleportation. Playwright executes the built production JavaScript and CSS in mobile portrait and desktop landscape contexts. It embeds sprite data because this runner blocks all URL navigation; the normal output remains a conventional Vite web build.

The browser suite checks station boot, responsive layouts, target selection, camera anchor, keyboard and joystick inertia, tilt fallback, visible drone deployment, cargo-on-return, docking, sale, module purchase, handling changes, and reload persistence.
