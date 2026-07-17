# Project Belter
## Game Design and Technical Implementation Outline

**Status:** First implementation specification  
**Primary target:** Smartphone browser  
**Secondary target:** Desktop browser  
**Recommended stack:** Phaser 3, TypeScript, Vite, DOM-based HUD, CSS  
**Initial mode:** Single-player, offline-capable, portrait-first responsive play

---

## 1. Product definition

Project Belter is a 2D top-down space-mining game built around Newtonian movement and relative velocity. The player begins as an independent asteroid miner operating from a small station in the Solar System. The player flies into nearby asteroid fields, identifies useful targets, matches their motion, deploys mining drones, survives debris and collisions, returns to the station, sells the haul, repairs the ship, and installs visibly represented modules.

The distinctive mechanic is that danger depends on **relative velocity**. A nearby asteroid moving with the player is safe. A small fragment crossing the player’s trajectory at high relative speed is dangerous. Successful mining therefore resembles a controlled rendezvous rather than an arcade shooting encounter.

The game should feel deliberate and physical without demanding precise multi-touch piloting. Phone tilt, target selection, navigation guidance, bounded assistance, and automatic drone deployment reduce control friction while preserving meaningful flight decisions.

### Player fantasy

The player is a resourceful belter who gradually turns a fragile mining craft into a specialized working ship. Progress should be visible on the ship itself. The player learns to read motion, choose profitable risks, and return from increasingly difficult expeditions.

### Design pillars

1. **Relative motion is the central skill.** Reaching an asteroid is easy; matching it safely is the challenge.
2. **Touch-light mobile piloting.** Tilt and contextual assistance make the game playable without constant joystick use.
3. **Mining requires position maintenance.** Drones automate extraction, while the player keeps the ship inside a safe operating envelope.
4. **Greed creates physical risk.** More cargo means more mass, poorer acceleration, longer braking, and a harder return.
5. **Progress changes both function and appearance.** Engines, cargo pods, armor, sensors, and drone racks are visible modules.
6. **Short expeditions support long progression.** A typical early run lasts about five minutes, while the career expands over many sessions.

---

## 2. Scope decisions for the first build

The first playable build should include:

- one station;
- one local asteroid field;
- one player ship chassis;
- Newtonian thrust without routine drag;
- touch targeting;
- tilt controls and virtual-joystick fallback;
- navigation guidance and optional velocity-matching assistance;
- automatic mining-drone launch inside a safe envelope;
- three resource types;
- collision damage based on relative velocity;
- fuel, hull, cargo, drones, and credits;
- return, docking, selling, repair, and upgrades;
- visible modular ship changes;
- local save data;
- desktop keyboard controls for development and accessibility.

The first build should exclude:

- combat;
- multiplayer;
- a simulated full Solar System;
- realistic orbital mechanics around planets;
- free-form trading between multiple stations;
- crew management;
- narrative campaigns;
- complex crafting;
- live-service systems;
- monetization.

These exclusions are scope guards, not permanent design decisions.

---

## 3. Target platform and orientation

### Primary layout

Use a **portrait-first** mobile layout. A ship anchored near the bottom of a tall viewport gives the player more forward visibility and makes tilt steering natural. Landscape and desktop layouts remain supported through responsive repositioning.

### Browser requirements

- modern mobile Chromium-based browsers;
- modern mobile Safari;
- desktop Chromium, Firefox, and Safari for development and fallback play;
- touch, pointer, keyboard, and device-orientation input paths;
- safe-area support for notches and browser UI;
- graceful handling when motion sensors are unavailable or permission is denied.

### Installability

Treat Progressive Web App support as a later vertical-slice task. The architecture should not prevent it. The first functional prototype may run as a normal web page.

---

## 4. Core game loop

### Station phase

1. Review ship status, cargo, contracts, and local market prices.
2. Sell resources from the previous run.
3. Repair damage, refuel, replace lost drones, or install modules.
4. Choose a contract or launch freely.

### Expedition phase

1. Undock from the station.
2. Travel toward the asteroid field.
3. Tap visible asteroids to inspect and target them.
4. Use navigation cues or approach assistance to intercept a target.
5. Reduce distance and relative velocity until the mining envelope is stable.
6. Mining drones launch automatically.
7. Maintain position while drones extract and return material.
8. Avoid fragments, moving asteroids, and mining-generated debris.
9. Decide when to stop, recall drones, and return.

### Return phase

1. Navigate back to the station beacon.
2. Enter the station approach zone at a safe relative speed.
3. Dock automatically after meeting docking conditions.
4. Convert the haul into credits and progression.

### Main tension

At each asteroid, the player chooses between leaving safely and remaining for another drone cycle. Continued extraction increases cargo mass, fuel use, time exposure, and debris risk.

---

## 5. Camera and world presentation

### Camera model

The camera follows and rotates with the player ship.

- The ship remains close to the horizontal center of the viewport.
- In portrait mode, the ship anchor is approximately **74% down the screen**.
- In landscape mode, the ship anchor is approximately **68–72% down the screen**.
- The ship’s nose normally points toward the top of the screen.
- The world rotates around the ship as the ship changes heading.
- The camera follows position with slight damping but should never visibly lag enough to impair collision judgment.
- Impacts may displace the ship by a few screen pixels and briefly shake the camera, after which it returns to the anchor.

### Forward view

The camera’s world center should sit ahead of the ship rather than directly on it. The forward offset may increase slightly with speed, but the ship’s screen position should remain stable.

Recommended implementation:

- fixed player screen anchor;
- camera center derived from `shipPosition + shipForward * lookAheadDistance`;
- look-ahead distance interpolated from speed and selected-target direction;
- target influence limited so the camera never swings independently of ship heading.

### Zoom

Use restrained dynamic zoom:

- normal field flight: default zoom;
- high speed: slight zoom out;
- close mining operation: slight zoom in if readability improves;
- dangerous collision: no abrupt automatic zoom;
- player setting to disable dynamic zoom.

### World readability

The player must be able to distinguish:

- ship heading;
- actual velocity direction;
- selected-target direction;
- target relative velocity;
- dangerous incoming debris;
- mining-safe distance;
- station return direction.

Do not rely on sprite orientation alone. Use vector indicators and clear motion trails.

---

## 6. Input model

All physical controls map into a shared action layer. Gameplay systems should consume actions rather than browser events.

### Actions

- `steer`: signed rotation input from -1 to 1;
- `thrustForward`: value from 0 to 1;
- `thrustReverse`: value from 0 to 1;
- `selectTarget(position)`;
- `clearTarget`;
- `toggleApproachAssist`;
- `holdMatchVelocity`;
- `recallDrones`;
- `dockOrInteract`;
- `pause`;
- `recalibrateTilt`.

### Tilt-control mode

Tilt mode is the recommended mobile control scheme.

- Phone roll controls left-right ship rotation.
- Phone pitch relative to the calibrated neutral position controls forward and reverse thrust.
- Small movements inside a dead zone produce no input.
- Input is smoothed to prevent jitter.
- Sensitivity, dead zone, inversion, and maximum tilt angle are settings.
- A visible recalibration button is available from the pause menu and optionally as a small HUD control.
- The neutral position is captured after the user holds the phone comfortably and taps **Calibrate**.
- Motion permission must be requested through an explicit user gesture.
- Denied or unavailable motion access immediately activates joystick controls.

Recommended initial values:

- roll dead zone: 3 degrees;
- pitch dead zone: 3 degrees;
- full input at approximately 18–22 degrees;
- low-pass smoothing over roughly 100–150 ms;
- reverse thrust requires a deliberate pitch beyond the neutral position.

### Virtual-joystick mode

Joystick mode is always available.

- Bottom-left virtual stick controls desired turn and thrust magnitude.
- Dragging upward applies forward thrust.
- Dragging downward applies reverse thrust.
- Horizontal displacement steers.
- Releasing the stick returns all commands to zero; it does not stop existing velocity.
- Optional separate thrust buttons may be added only if testing shows the combined stick is unclear.

### Touch targeting

- Tap an asteroid, station, wreck, or other targetable object to select it.
- Use a generous screen-space hit radius larger than the visible sprite.
- When targets overlap, choose the closest target to the tap, weighted toward the visually frontmost object.
- Tapping empty space clears the target only when the tap is outside the lower control area.
- A selected target receives a world-space outline, target marker, and HUD summary.
- Long-pressing a target may engage approach assistance as a convenience shortcut.

### Desktop controls

- `A` / `D` or left / right arrows: steer;
- `W` / up arrow: forward thrust;
- `S` / down arrow: reverse thrust;
- mouse click: select target;
- `Shift`: hold velocity match;
- `E`: approach assist or contextual action;
- `R`: recall drones;
- `Esc`: pause.

### Control priority

- Direct player input overrides approach assistance.
- Opening a menu, station panel, or modal suspends flight input.
- Tilt input should not leak through while the game is paused.

---

## 7. Flight and physics

### Simulation model

Use a custom deterministic 2D physics layer rather than placing core rules inside Phaser scene callbacks.

- fixed simulation step, preferably 60 Hz;
- position, linear velocity, heading, angular velocity, mass, and acceleration;
- no routine linear drag;
- no routine automatic slowing;
- optional mild angular damping for control readability;
- simulation units should be internally consistent, with one world unit treated as approximately one meter;
- rendering interpolates between simulation states when necessary.

### Player ship movement

The initial ship has:

- main forward engine;
- weaker reverse thrusters;
- rotational maneuvering thrusters;
- fuel consumption proportional to applied thrust;
- dry mass plus module mass plus cargo mass;
- acceleration derived from thrust divided by current mass.

Cargo therefore reduces acceleration and braking performance without requiring a separate penalty rule.

### Speed handling

Do not impose a visible arcade speed cap. Use:

- finite engine thrust;
- finite fuel;
- large travel space;
- warnings for unsafe velocity;
- emergency-return assistance when the player leaves the intended sector;
- a very high internal safety clamp only to prevent numerical instability.

### Asteroid movement

Each asteroid has:

- linear position and velocity;
- angular spin used for visuals and optional mining difficulty;
- radius and mass class;
- material composition;
- remaining yield;
- structural stability;
- optional debris-generation profile.

Asteroids in the same field should share a broad drift direction with meaningful local variation. This creates safe clusters and dangerous crossings rather than random Brownian motion.

### Relative velocity

For any two objects:

`relativeVelocity = objectVelocity - shipVelocity`

Display and damage calculations use its magnitude. The selected target HUD should prioritize relative speed over absolute speed.

### Collision model

Use circle colliders for the first build. Large or irregular sprites may later use several circles.

Collision consequences depend on:

- relative speed at impact;
- colliding object size or effective mass;
- impact angle;
- armor and structural modules;
- whether the collision affects the hull, cargo pod, engine, or drone rack.

Recommended initial relative-speed bands:

- below 2 m/s: safe contact or negligible bump;
- 2–6 m/s: minor damage and camera feedback;
- 6–15 m/s: serious module or hull damage;
- above 15 m/s: severe damage, cargo loss, or ship disablement.

All values must be centralized as tunable configuration rather than embedded in system code.

### Station safety

The station has:

- a low-speed docking corridor;
- collision avoidance or traffic-control behavior near the docking zone;
- no arbitrary invulnerability outside the docking volume;
- forgiving minor-contact handling to avoid punishing new players during the first minute.

---

## 8. Targeting and navigation assistance

### Target lock

Selecting an asteroid creates a navigation lock. The game shows:

- target name or class;
- distance to surface;
- relative speed;
- estimated composition;
- estimated remaining yield;
- risk or stability indicator;
- direction marker when off-screen;
- projected closest-approach point;
- current mining-envelope status.

### Navigation cues

World-space cues should show:

- a line or arrow from ship to target;
- the ship’s velocity vector;
- the target’s relative-motion vector;
- a ghost or reticle indicating the desired interception direction;
- braking warning when stopping distance exceeds remaining distance;
- safe-speed ring near the target.

Cues should fade when unnecessary and avoid turning the playfield into a technical diagram.

### Approach assist

Approach assist is optional and physically bounded.

- It applies ordinary ship thrust; it never teleports or directly edits velocity.
- It attempts to approach a point outside the asteroid surface and reduce relative speed.
- It respects current thrust, mass, and fuel.
- It disengages when the player provides strong manual input, fuel is insufficient, collision danger is critical, or the target becomes invalid.
- It does not guarantee obstacle avoidance in the first prototype.
- It should clearly display when active.

### Match-velocity control

A separate hold action may command the flight computer to reduce relative velocity to the selected target.

- The action uses available forward, reverse, and rotational thrust.
- It may rotate the ship before applying the main engine.
- It stops when released.
- It communicates estimated time to match.
- It can fail gracefully when fuel or thrust is insufficient.

This control provides mobile accessibility while preserving the cost of mass, fuel, and poor approach geometry.

---

## 9. Mining system

### Mining eligibility

Automatic mining begins only when all conditions are met:

- a mineable asteroid is selected;
- the ship has at least one operational drone;
- cargo space remains;
- distance from the asteroid surface is below the mining threshold;
- relative speed is below the mining threshold;
- the ship remains stable for a short arming period;
- the target is not depleted;
- the drone path is not blocked by a large object.

Recommended initial thresholds:

- mining distance from surface: 25–40 m, depending on asteroid size;
- maximum relative speed to arm: 2 m/s;
- arming time: 1.0–1.5 seconds;
- outer pause radius: 60 m;
- automatic emergency recall above 5 m/s relative speed or after a collision.

### Auto-mine behavior

- Auto-mine is enabled by default and may be disabled in settings.
- A visible indicator moves through `Not Ready`, `Stabilizing`, `Launching`, and `Mining` states.
- Drones launch automatically after the safe envelope remains stable.
- The player can recall drones at any time.
- Selecting another target recalls or abandons the current operation according to drone state.
- Accidental brief entry into the envelope should not launch drones because of the arming delay.

### Drone cycle

Each drone performs a visible cycle:

1. launch from ship module;
2. travel to a chosen surface point;
3. attach or hover;
4. extract material over time;
5. detach;
6. return to the ship;
7. transfer cargo;
8. repeat while conditions remain valid.

Cargo is credited when the drone returns, not when extraction begins. A lost drone may therefore lose its carried material.

### Position maintenance

Mining continues normally while the ship remains inside the operational envelope. If the player drifts:

- mild drift pauses extraction and prompts correction;
- greater drift orders drones to return;
- dangerous drift may strand or destroy drones;
- returning to the envelope resumes after stabilization.

### Mining risk

Mining gradually increases local hazard:

- fragments are released from the surface;
- the asteroid’s spin or stability may worsen;
- volatile pockets may eject material;
- nearby rubble may be disturbed;
- valuable asteroids can have higher instability.

The first build needs one clear hazard: periodic debris fragments with visible trajectories and collision damage. Additional hazards remain data-driven future content.

### Resource types for the first build

1. **Water ice** — common, low price, useful later for fuel systems.
2. **Industrial metals** — common-to-uncommon, reliable income.
3. **Rare metals** — low yield, high value, often found in less stable targets.

Each asteroid may contain one primary resource and one low-probability secondary resource.

---

## 10. Damage, failure, and recovery

### Ship state

The ship tracks:

- hull integrity;
- fuel;
- cargo capacity and current cargo mass;
- engine condition;
- maneuvering-thruster condition;
- sensor condition;
- drone-bay condition;
- cargo-pod condition;
- number and condition of drones.

The first build may simplify module damage to hull damage plus one temporarily impaired subsystem, provided the architecture supports later expansion.

### Functional damage

Damage should alter play:

- engine damage reduces forward thrust;
- maneuvering damage reduces turn rate;
- cargo damage can leak unsecured resources;
- drone-bay damage slows or prevents launch;
- sensor damage reduces targeting range or estimate quality;
- armor absorbs damage but adds mass.

### Disabled ship

A disabled ship ends the expedition without deleting career progress.

Recommended consequence:

- rescue and towing fee;
- loss of some or all unsecured cargo;
- chance of losing damaged drones;
- required repairs;
- no loss of purchased chassis or permanent modules.

The first expedition should include a reduced rescue penalty.

### Feedback

Impacts should produce:

- brief camera shake scaled by severity;
- directional impact flash;
- audio and optional haptic pulse;
- visible damage particles;
- concise subsystem warning;
- clear relative-speed value for major collisions so the player learns the rule.

---

## 11. Station, economy, and contracts

### Docking

The station is always targetable. Selecting it provides return navigation.

Automatic docking occurs when:

- the ship enters the docking zone;
- relative speed to the station is below the threshold;
- the ship is not in a critical collision state;
- drones are aboard or explicitly abandoned;
- a short docking stabilization completes.

Approach assistance may align the ship with the station after the player reaches the local docking area.

### Station interface

Use a DOM overlay or separate station screen with these sections:

- **Market:** sell individual resources or sell all;
- **Repair:** repair hull and damaged modules;
- **Fuel and drones:** refuel and replace drones;
- **Shipyard:** install, remove, buy, and compare modules;
- **Contracts:** choose optional objectives;
- **Launch:** return to flight.

### Economy for the first build

Use simple, readable prices.

- fixed base prices per resource;
- small session-level demand modifiers may be added after the loop works;
- repairs and fuel create recurring costs;
- destroyed drones create a meaningful but recoverable loss;
- upgrades should usually require two to four successful early expeditions.

Avoid complex dynamic markets until travel between several stations exists.

### Contract examples

Initial contracts can be generated from simple templates:

- deliver a specified quantity of water ice;
- deliver industrial metal above a minimum purity;
- scan three asteroids of a given class;
- recover a lost survey drone;
- complete an expedition with hull integrity above a threshold.

The prototype only needs one or two contract types. Free mining must remain possible.

---

## 12. Progression and modular ships

### Progression resources

- credits;
- optional station reputation later;
- no second premium or abstract upgrade currency.

### Module slots

The initial ship chassis should expose visible hardpoints such as:

- main engine slot;
- left and right external utility slots;
- dorsal sensor slot;
- ventral drone-bay slot;
- cargo attachment slots;
- armor overlay points.

### Module categories

1. **Main engine** — more thrust, fuel use, heat, and visible engine size.
2. **Retro thrusters** — stronger braking and safer rendezvous.
3. **Maneuvering package** — faster rotation and later lateral control.
4. **Cargo pods** — more capacity, more mass, larger collision profile.
5. **Drone bay** — more simultaneous drones or faster turnaround.
6. **Sensor array** — longer scan range and more precise composition estimates.
7. **Armor plating** — greater impact tolerance at the cost of mass.

### Upgrade philosophy

Modules should create tradeoffs rather than pure percentage improvements. Examples:

- a larger engine accelerates faster but consumes more fuel;
- armor survives impacts but makes matching velocity harder;
- external cargo pods increase capacity and ship width;
- a large drone bay improves extraction but occupies a utility slot;
- better sensors improve target choice without directly improving survival.

### Visual assembly

Build the ship from layered or attached sprite components.

- one base hull sprite;
- module sprites placed at named anchor points;
- thruster effects emitted from module-specific coordinates;
- cargo pods and armor change silhouette;
- damage overlays attach to affected modules;
- render order defined by slot metadata;
- ship appearance reconstructed from save data.

For the earliest prototype, clean vector shapes or simple authored sprites are sufficient. The modular assembly system should exist before polished art.

### New ships

New chassis are outside the first build but the data model should support them. Future chassis should represent roles rather than direct tiers:

- agile prospector;
- drone carrier;
- heavy tug;
- long-range survey vessel;
- cargo hauler;
- armed escort.

---

## 13. HUD and interaction design

### Persistent HUD budget

Keep the center and forward path clear. Persistent HUD should cover as little of the playfield as possible.

Recommended portrait arrangement:

- **top-left:** hull, fuel, and cargo compact bars;
- **top-right:** selected-target summary;
- **screen edges:** off-screen target and danger markers;
- **bottom-left:** virtual joystick only when enabled;
- **bottom-right:** contextual action and drone recall;
- **near ship:** velocity vector, mining envelope, and transient warnings;
- **pause/settings:** noncritical information and control configuration.

### Target summary

Show only the information needed during flight:

- target icon and resource estimate;
- distance;
- relative speed;
- mining readiness;
- remaining yield or scan uncertainty.

### Contextual action

One main contextual button changes label and behavior by state:

- `ASSIST` when a distant target is selected;
- `MATCH` during final approach;
- `RECALL` while drones are out;
- `DOCK` near the station;
- hidden when no useful action exists.

Do not require a permanent row of six buttons.

### Velocity indicators

- ship heading is represented by the ship itself;
- actual velocity is a line or arrow extending from the ship;
- selected target relative velocity uses a distinct marker;
- dangerous incoming debris gains edge warnings and short projected paths;
- indicators scale or clamp so high speed does not draw lines across the entire screen.

### Mining envelope

When close to a selected asteroid:

- show a subtle safe-distance ring or bracket;
- show relative-speed status;
- display a short stabilization progress arc;
- switch to mining state once drones launch;
- avoid a large central progress box.

### Onboarding

The first session should teach through a short guided contract:

1. calibrate tilt or choose joystick;
2. apply thrust;
3. observe that releasing thrust does not stop the ship;
4. select a slow nearby asteroid;
5. follow the relative-velocity indicator;
6. match speed;
7. allow drones to auto-launch;
8. collect one drone load;
9. recall and return;
10. dock and sell.

Tutorial prompts should pause or slow the game only when necessary.

---

## 14. Visual and audio direction

### Visual direction

Aim for industrial near-future space rather than glossy fantasy spacecraft.

- dark space background with restrained star parallax;
- readable silhouettes;
- strong engine and maneuvering-thruster effects;
- mineral and hazard differences visible through texture and shape as well as color;
- modest interface chrome resembling practical ship instrumentation;
- modular additions should make the ship look increasingly improvised and capable;
- avoid dense cockpit overlays and generic dashboard cards.

### Motion

- asteroid drift should be smooth and legible;
- ship thrust must visibly correspond to acceleration;
- drones should be individually visible at normal mining zoom;
- debris trails should communicate direction and danger;
- screen shake should be brief and limited;
- support reduced-motion settings for nonessential UI animation.

### Audio

Space itself is silent, but the game can present sounds as ship-transmitted feedback.

- engine vibration and thrust tone;
- maneuvering-thruster clicks;
- sensor lock cue;
- stabilization cue;
- drone launch, drill, return, and cargo-transfer sounds;
- hull impact and subsystem alarm;
- station docking clamps;
- subdued ambient music with increased tension during dangerous relative-speed encounters.

### Haptics

Use optional browser vibration where supported:

- short pulse on target lock;
- gentle pulse on mining stabilization;
- stronger pulse on collision;
- user setting to disable all haptics.

---

## 15. World and content generation

### Local sector

The first sector contains:

- station near the origin;
- safe station perimeter;
- sparse transit zone;
- denser asteroid field at a moderate travel distance;
- respawn or streaming boundaries beyond normal play space.

### Asteroid population

Recommended first target:

- 30–50 active asteroids in the simulation;
- 10–20 visible during typical field navigation;
- several size classes;
- field-wide mean drift plus individual velocity deviations;
- seeded generation for reproducible testing;
- targetable resource and risk properties generated from data tables.

### Debris

Use object pooling. Debris can be simplified to:

- small circular colliders;
- limited lifetime;
- inherited asteroid velocity plus ejection velocity;
- clear trail at dangerous relative speed;
- reduced update frequency when far off-screen.

### Streaming

The first build may use a bounded local sector. The architecture should later support sector streaming without treating Phaser sprites as authoritative state.

---

## 16. Technical architecture

### Stack

- Phaser 3 for rendering, scene lifecycle, camera, particles, and asset loading;
- TypeScript;
- Vite;
- HTML/CSS DOM overlay for HUD, station menus, settings, and accessibility-sensitive controls;
- Vitest for unit tests;
- Playwright for browser smoke tests and mobile viewport checks;
- localStorage for the first save implementation, with a migration path to IndexedDB if save complexity grows.

A React dependency is unnecessary for the first build. Use lightweight TypeScript DOM components unless the interface later becomes complex enough to justify a framework.

### Architectural rule

Simulation state is authoritative and independent from Phaser display objects.

- systems update simulation entities;
- scenes translate simulation state into sprites, particles, camera motion, and audio;
- input services translate browser events into game actions;
- HUD reads a presentation state derived from simulation data;
- saves serialize simulation and career state, never Phaser objects.

### Suggested directory structure

```text
src/
  main.ts
  app/
    GameApp.ts
    AppState.ts
  game/
    config/
      constants.ts
      tuning.ts
    scenes/
      BootScene.ts
      FlightScene.ts
      DebugScene.ts
    simulation/
      GameSimulation.ts
      SimulationClock.ts
      EntityStore.ts
      components.ts
      events.ts
      systems/
        FlightSystem.ts
        AsteroidSystem.ts
        TargetingSystem.ts
        NavigationSystem.ts
        CollisionSystem.ts
        DamageSystem.ts
        MiningSystem.ts
        DroneSystem.ts
        CargoSystem.ts
        DockingSystem.ts
        EconomySystem.ts
    rendering/
      ShipView.ts
      AsteroidView.ts
      DroneView.ts
      DebrisView.ts
      StationView.ts
      CameraRig.ts
      ViewRegistry.ts
      effects/
    input/
      InputManager.ts
      TiltController.ts
      TouchTargeting.ts
      VirtualJoystick.ts
      KeyboardController.ts
      InputActions.ts
    ui/
      HudRoot.ts
      FlightHud.ts
      TargetPanel.ts
      StationPanel.ts
      SettingsPanel.ts
      TutorialOverlay.ts
      styles.css
    data/
      ships.json
      modules.json
      asteroids.json
      resources.json
      contracts.json
    progression/
      CareerState.ts
      ShipLoadout.ts
      Market.ts
    save/
      SaveService.ts
      SaveSchema.ts
      migrations.ts
    audio/
      AudioManager.ts
  assets/
    manifest.ts
    ships/
    asteroids/
    station/
    drones/
    ui/
    fx/
    audio/
tests/
  unit/
  integration/
  e2e/
```

### Main simulation entities

- player ship;
- asteroid;
- station;
- mining drone;
- debris fragment;
- optional navigation marker or contract object.

### Core components

- transform;
- velocity;
- heading and angular state;
- mass;
- collider;
- health and damage state;
- targetable metadata;
- resource deposit;
- cargo hold;
- fuel tank;
- thruster set;
- drone bay;
- station docking data;
- render archetype.

### State machines

Use explicit state machines for complex flows.

**Flight state:**

- `Undocking`;
- `FreeFlight`;
- `TargetLocked`;
- `ApproachAssist`;
- `Mining`;
- `Returning`;
- `Docking`;
- `Disabled`.

**Mining state:**

- `Idle`;
- `Stabilizing`;
- `Launching`;
- `Extracting`;
- `ReturningCargo`;
- `Paused`;
- `Recalling`;
- `Complete`.

**Station state:**

- `Market`;
- `Repair`;
- `Shipyard`;
- `Contracts`;
- `ReadyToLaunch`.

### Event examples

- `TargetSelected`;
- `TargetCleared`;
- `MiningEnvelopeEntered`;
- `MiningStarted`;
- `DroneLaunched`;
- `CargoDelivered`;
- `CollisionOccurred`;
- `SubsystemDamaged`;
- `DockingStarted`;
- `DockingCompleted`;
- `ResourceSold`;
- `ModuleInstalled`;
- `SaveRequested`.

Use typed events and avoid scene-specific global flags.

---

## 17. Data model examples

### Ship chassis

```ts
interface ShipChassisDefinition {
  id: string;
  displayName: string;
  baseMass: number;
  baseHull: number;
  baseFuelCapacity: number;
  baseCargoCapacity: number;
  moduleSlots: ModuleSlotDefinition[];
  spriteKey: string;
  moduleAnchors: Record<string, { x: number; y: number; rotation: number }>;
}
```

### Module

```ts
interface ModuleDefinition {
  id: string;
  displayName: string;
  category: ModuleCategory;
  compatibleSlots: string[];
  purchasePrice: number;
  mass: number;
  statModifiers: Record<string, number>;
  spriteKey: string;
  renderLayer: number;
}
```

### Asteroid

```ts
interface AsteroidState {
  id: string;
  position: Vector2;
  velocity: Vector2;
  radius: number;
  spin: number;
  composition: ResourceDeposit[];
  stability: number;
  remainingYield: number;
  colliderRadius: number;
  seed: number;
}
```

### Save

```ts
interface SaveGameV1 {
  version: 1;
  credits: number;
  careerStats: CareerStats;
  ownedModules: string[];
  activeChassisId: string;
  installedModules: Record<string, string | null>;
  shipCondition: SerializedShipCondition;
  settings: PlayerSettings;
  activeContractIds: string[];
  lastSavedAt: string;
}
```

---

## 18. Save, pause, and lifecycle behavior

### Save points

Save automatically:

- after docking;
- after buying, selling, repairing, or changing modules;
- when the browser loses visibility;
- at safe periodic intervals during an expedition;
- before unload where supported.

### Mid-expedition save

The first prototype may save only at the station. The architecture should still separate career state from expedition state so mid-run saves can be added later.

### Pause

Pause when:

- the user opens the pause menu;
- the browser tab becomes hidden;
- a system permission prompt interrupts play;
- orientation changes significantly and recalibration is required.

Do not continue fuel use, collisions, or mining in the background.

### Save versioning

Every save includes a schema version. Add migration functions from the first release rather than postponing versioning.

---

## 19. Performance requirements

### Targets

- 60 frames per second on a representative mid-range smartphone;
- stable 30 frames per second fallback under load;
- responsive touch latency;
- no visible allocation spikes during mining or debris events;
- fast restart after tab suspension.

### Techniques

- object pools for asteroids, debris, drones, particles, and damage effects;
- spatial hash or uniform grid for collision broad phase;
- render culling outside the viewport;
- lower update frequency for distant noncritical entities;
- capped device pixel ratio on high-density screens;
- compressed audio and image assets;
- deterministic seeded generation for repeatable performance tests;
- debug overlay showing FPS, entity count, collision checks, and simulation step time.

---

## 20. Accessibility and settings

Required settings:

- tilt or joystick control mode;
- tilt calibration;
- tilt sensitivity;
- tilt dead zone;
- invert pitch;
- dynamic zoom on or off;
- screen shake intensity;
- haptics on or off;
- music and effects volume;
- reduced UI motion;
- larger HUD text;
- color-independent hazard icons;
- auto-mine on or off;
- approach assistance strength or availability.

The game must remain fully playable without tilt, haptics, audio, or color discrimination.

---

## 21. Testing and quality assurance

### Unit tests

Test at least:

- vector and relative-velocity calculations;
- thrust and mass effects;
- fixed-step integration;
- collision speed bands;
- mining eligibility;
- mining pause and recall transitions;
- cargo capacity and transfer;
- economy transactions;
- module stat aggregation;
- save serialization and migration;
- input dead-zone and calibration mapping.

### Integration tests

- select asteroid, approach, stabilize, mine, and receive cargo;
- drift outside mining envelope and verify pause or recall;
- collide at low and high relative speed and verify different outcomes;
- dock and sell cargo;
- install a module and verify physics and visual changes;
- reload and verify persistence.

### Browser smoke tests

Use Playwright where practical:

- boot into the first actionable screen;
- load portrait and landscape viewport sizes;
- verify HUD does not cover the ship or forward target;
- verify touch target selection through pointer emulation;
- verify pause on visibility change;
- verify joystick fallback when motion access is unavailable;
- capture screenshots of station, free flight, target lock, mining, collision warning, and shipyard states.

### Manual device tests

Real-device testing is required for:

- tilt permission flow;
- calibration comfort;
- sensor jitter;
- browser bars and safe areas;
- touch target precision;
- haptics;
- battery and heat;
- performance during debris-heavy mining.

---

## 22. Implementation milestones

### Milestone 0 — Repository and technical foundation

Deliver:

- Vite, Phaser, and TypeScript project;
- game canvas plus DOM overlay;
- responsive portrait and landscape shell;
- asset manifest;
- simulation clock and entity store;
- debug overlay;
- Vitest and Playwright configuration.

Acceptance:

- project runs locally;
- resize works;
- simulation and rendering are separate;
- debug entity moves under keyboard control.

### Milestone 1 — Flight sandbox

Deliver:

- player ship;
- custom thrust and rotation physics;
- fixed camera anchor near the bottom of the screen;
- world rotation with ship heading;
- velocity vector;
- fuel use;
- keyboard, joystick, and tilt input adapters;
- calibration UI;
- basic asteroids with drift and circle collisions.

Acceptance:

- releasing thrust preserves velocity;
- cargo-mass test changes acceleration;
- low- and high-relative-speed impacts differ;
- camera remains readable on mobile viewports;
- joystick works without motion sensors.

### Milestone 2 — Targeting and navigation

Deliver:

- touch selection;
- target outline and HUD;
- distance and relative-speed display;
- off-screen target marker;
- velocity-match hold action;
- optional approach assist;
- station targeting.

Acceptance:

- player can select moving asteroids reliably;
- target information updates correctly;
- assist uses normal thrust and can be overridden;
- no hidden velocity changes occur.

### Milestone 3 — Mining loop

Deliver:

- asteroid resource deposits;
- mining envelope;
- stabilization timer;
- automatic drone launch;
- visible drone cycles;
- cargo transfer;
- recall, pause, loss, and depletion states;
- mining-generated debris.

Acceptance:

- drones never launch outside the safe envelope;
- cargo is added only after drone return;
- drifting pauses or recalls mining;
- debris can damage the ship based on relative speed;
- depleted targets stop producing resources.

### Milestone 4 — Station and economy

Deliver:

- docking envelope and automatic docking;
- station interface;
- sell resources;
- fuel, repair, and drone replacement;
- credits;
- one basic contract type;
- station save point.

Acceptance:

- a complete expedition from launch to sale is possible;
- costs and rewards update correctly;
- career state persists after reload.

### Milestone 5 — Modular progression

Deliver:

- module data model;
- ship hardpoints and visual assembly;
- shipyard interface;
- at least five purchasable modules across three categories;
- module mass and stat effects;
- save persistence for loadouts.

Acceptance:

- installed modules visibly change the ship;
- cargo pods alter capacity and mass;
- engine upgrade alters thrust or fuel use;
- removing a module restores the previous values;
- reloading reconstructs the correct appearance.

### Milestone 6 — Onboarding and polish

Deliver:

- guided first contract;
- audio and optional haptics;
- accessibility settings;
- performance optimization;
- PWA support if stable;
- screenshot and browser QA pass;
- tuned early economy and collision thresholds.

Acceptance:

- a new player can complete the first mining run without external instructions;
- the HUD remains readable in portrait and landscape;
- the game meets the agreed mobile performance target;
- controls remain usable after tab suspension and orientation changes.

---

## 23. Initial tuning constants

Create a central configuration file and begin with these approximate values. They are placeholders for playtesting.

```ts
export const tuning = {
  simulationHz: 60,
  portraitShipAnchorY: 0.74,
  landscapeShipAnchorY: 0.70,
  cameraLookAheadMin: 40,
  cameraLookAheadMax: 120,

  tiltDeadZoneDegrees: 3,
  tiltFullInputDegrees: 20,
  tiltSmoothingMs: 120,

  safeContactSpeed: 2,
  minorDamageSpeed: 6,
  seriousDamageSpeed: 15,

  miningDistanceFromSurface: 35,
  miningArmRelativeSpeed: 2,
  miningArmSeconds: 1.25,
  miningPauseDistance: 60,
  miningEmergencyRecallSpeed: 5,

  dockingDistance: 80,
  dockingMaxRelativeSpeed: 2.5,
  dockingStabilizeSeconds: 1.5,

  startingCredits: 200,
  startingFuel: 100,
  startingCargoCapacity: 20,
  startingDrones: 2,
};
```

Do not tune by changing values scattered across systems.

---

## 24. Codex starting task list

Codex should begin with the following sequence:

1. Create the Phaser 3, TypeScript, and Vite project.
2. Add the proposed directory structure and an asset manifest with placeholder assets.
3. Implement a fixed-step `GameSimulation` independent of Phaser.
4. Implement the player ship state, thrust, rotation, mass, fuel, and velocity.
5. Add a thin `FlightScene` that renders simulation state.
6. Implement `CameraRig` with the ship fixed near the bottom and the world rotated around ship heading.
7. Add keyboard input first, then virtual joystick, then tilt adapter through the same action interface.
8. Add a responsive DOM HUD showing fuel, hull, cargo, and velocity.
9. Spawn seeded moving asteroids and implement circle collisions using relative speed.
10. Add touch target selection and target HUD.
11. Add navigation cues and velocity-match assistance.
12. Implement the mining state machine and one visible drone.
13. Add cargo, docking, station sale, and save persistence.
14. Add modular ship anchor points and one visible engine and cargo-pod upgrade.
15. Add automated tests and screenshots at each milestone.

The first pull request should stop after Milestone 1 unless the repository workflow explicitly prefers larger vertical slices.

---

## 25. Definition of the first playable vertical slice

The vertical slice is complete when a player can:

1. open the game on a phone browser;
2. choose tilt or joystick controls;
3. launch from a station;
4. fly with inertia and no routine drag;
5. tap a moving asteroid;
6. read distance and relative velocity;
7. approach manually or with bounded assistance;
8. stabilize near the asteroid;
9. watch drones launch automatically;
10. remain nearby while cargo is collected;
11. avoid or survive mining debris;
12. recall drones;
13. return and dock;
14. sell the haul;
15. buy an upgrade that visibly changes the ship and alters its handling;
16. reload the page and retain progression.

The build is not ready merely because these systems exist in isolation. The full sequence must be understandable and enjoyable as one uninterrupted loop.

---

## 26. Future roadmap

### Additional mining depth

- richer scans and uncertain composition estimates;
- volatile pockets;
- grappling and anchoring;
- rotating rubble piles;
- drone specialization;
- salvage and wreck recovery;
- asteroid claims and contested resources.

### Expanded economy

- multiple stations;
- local demand and supply;
- hauling contracts;
- fuel production from water;
- refinery modules;
- reputation and faction access;
- long-range route planning.

### Encounters

Before weapons, add:

- rescue missions;
- towing;
- racing;
- claim disputes;
- rival miners;
- customs inspection;
- dangerous abandoned craft.

### Combat

Combat should use the same relative-motion model.

- interception and escape rather than circling;
- projectile velocity and closing speed;
- heat, ammunition, and sensor locks;
- module damage;
- defensive drones;
- strong economic cost for fighting.

Combat should be added only after flight, targeting, and ship encounters are already satisfying.

### Solar System expansion

- local sectors around Earth, the Moon, Mars, and the main belt;
- sector map rather than continuous full-scale simulation;
- travel time, fuel, and resupply decisions;
- delayed communication as a contract and market mechanic;
- different station economies and political environments.

---

## 27. Final design rule

Every major system should reinforce the same idea: **space is manageable when velocities align and dangerous when they do not**. Navigation, mining, damage, upgrades, cargo, contracts, and eventual combat should all remain legible through that principle.
