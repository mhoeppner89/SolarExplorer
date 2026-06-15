# Solar Explorer

Static HTML games for exploring the solar system in German and English.

## Run Locally

```bash
npm run serve
```

Then open `http://127.0.0.1:8123`.

The explorer pages use CDN-hosted Tailwind, Three.js, OrbitControls, and canvas-confetti, so the 3D explorer needs network access when first loaded. The landing page and Memory game use local files only.

## Pages

- `index.html` - German game station.
- `solarexplorer_deutsch.html` - German 3D Solar Explorer.
- `SolarExplorer.html` - English 3D Solar Explorer.
- `memory_deutsch.html` - German Memory game.

## Checks

```bash
npm test
```

The static checker verifies local links/assets, required game state hooks, and basic explorer/runtime wiring.

## Notes

The two 3D explorer pages keep localized educational content in their HTML files and share interaction/rendering behavior through `scripts/explorer-runtime.js`.
