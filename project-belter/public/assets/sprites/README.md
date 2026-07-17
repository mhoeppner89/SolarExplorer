# Sprite assets

These game-ready PNG sprites were derived from original image-generation outputs created for Project Belter in this implementation session. No third-party stock art is included.

Source sheets:

- industrial mining ship with drone bay;
- radial industrial station;
- eight-asteroid and debris sheet;
- mining-drone and cargo-module sheet;
- industrial HUD reference sheet used for visual direction only.
- twelve-asteroid family atlas with carbonaceous, icy, and metallic rows and four silhouettes per family.

Processing applied:

- checkerboard background removal;
- connected-component crop extraction;
- transparent edge cleanup;
- consistent canvas padding;
- downsampling for browser delivery;
- separate stable filenames for Phaser manifest keys.

Runtime assets:

- `ship_base.png`
- `station.png`
- `asteroid_0.png` through `asteroid_7.png`
- `asteroid_carbon_0_v3.png` through `asteroid_carbon_3_v3.png`
- `asteroid_icy_0_v3.png` through `asteroid_icy_3_v3.png`
- `asteroid_metallic_0_v3.png` through `asteroid_metallic_3_v3.png`
- `drone_0.png` through `drone_3.png`
- `debris_0.png` through `debris_5.png`
- `module_engine.png`, `module_retro.png`, and `module_cargo.png`
