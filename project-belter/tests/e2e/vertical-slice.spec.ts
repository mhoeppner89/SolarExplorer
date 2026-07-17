import { expect, test, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const distRoot = resolve(process.cwd(), 'dist');
const spriteRoot = resolve(process.cwd(), 'public/assets/sprites');
const indexHtml = readFileSync(resolve(distRoot, 'index.html'), 'utf8');
const scriptMatch = indexHtml.match(/<script[^>]+src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/);
const styleMatch = indexHtml.match(/<link[^>]+href="\.\/(assets\/[^"]+\.css)"[^>]*>/);

if (scriptMatch?.[1] === undefined || styleMatch?.[1] === undefined) {
  throw new Error('Could not locate the built JavaScript and CSS assets for browser tests.');
}

const bundledScript = readFileSync(resolve(distRoot, scriptMatch[1]), 'utf8').replaceAll('</script>', '<\\/script>');
const bundledStyles = readFileSync(resolve(distRoot, styleMatch[1]), 'utf8');
const assetData = Object.fromEntries(
  readdirSync(spriteRoot)
    .filter((filename) => filename.endsWith('.png'))
    .map((filename) => [
      `./assets/sprites/${filename}`,
      `data:image/png;base64,${readFileSync(resolve(spriteRoot, filename)).toString('base64')}`,
    ]),
);
const assetBootstrap = `<script>window.__BELTER_ASSET_DATA__=${JSON.stringify(assetData)};</script>`;
const inlineBuild = indexHtml
  .replace('<head>', `<head>${assetBootstrap}`)
  .replace(scriptMatch[0], `<script type="module">${bundledScript}</script>`)
  .replace(styleMatch[0], `<style>${bundledStyles}</style>`);

const installStorageShim = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    type TestWindow = Window & typeof globalThis & {
      __BELTER_E2E_STORAGE__?: Map<string, string>;
    };
    const testWindow = window as TestWindow;
    const storage = testWindow.__BELTER_E2E_STORAGE__ ?? new Map<string, string>();
    testWindow.__BELTER_E2E_STORAGE__ = storage;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      enumerable: true,
      value: {
        get length() { return storage.size; },
        clear: () => storage.clear(),
        getItem: (key: string) => storage.get(key) ?? null,
        key: (index: number) => [...storage.keys()][index] ?? null,
        removeItem: (key: string) => storage.delete(key),
        setItem: (key: string, value: string) => storage.set(key, String(value)),
      } satisfies Storage,
    });
  });
};

const bootInlineGame = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.__BELTER_DEBUG__?.destroy();
  });
  await installStorageShim(page);
  await page.setContent(inlineBuild, { waitUntil: 'load' });
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForFunction(() => window.__BELTER_DEBUG__ !== undefined);
  await page.waitForFunction(() => window.__BELTER_DEBUG__?.getSnapshot().entityCount !== undefined);
};

const waitForGame = async (page: Page): Promise<string[]> => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  await bootInlineGame(page);
  return pageErrors;
};

const launch = async (page: Page): Promise<void> => {
  await expect(page.getByTestId('station-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Launch expedition' }).click();
  await expect.poll(
    async () => page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot().phase),
  ).toBe('flight');
  await expect(page.getByTestId('station-panel')).toBeHidden();
};

const expectCameraAnchor = async (page: Page, portrait: boolean): Promise<void> => {
  const telemetry = await page.evaluate(() => window.__BELTER_DEBUG__?.getCameraTelemetry());
  expect(telemetry).toBeDefined();
  expect(telemetry?.anchorX).toBeCloseTo(0.5, 3);
  expect(telemetry?.anchorY ?? 0).toBeGreaterThan(portrait ? 0.70 : 0.66);
  expect(telemetry?.anchorY ?? 1).toBeLessThan(portrait ? 0.77 : 0.74);
};

const getTutorialTargetScreenPoint = async (page: Page): Promise<{ x: number; y: number } | null> =>
  page.evaluate(() => {
    const bridge = window.__BELTER_DEBUG__;
    if (bridge === undefined) {
      return null;
    }
    const snapshot = bridge.getSnapshot();
    const camera = bridge.getCameraTelemetry();
    const target = bridge.getTutorialTarget();
    if (target === null) {
      return null;
    }
    const dx = target.position.x - snapshot.ship.position.x;
    const dy = target.position.y - snapshot.ship.position.y;
    const cos = Math.cos(camera.rotation);
    const sin = Math.sin(camera.rotation);
    return {
      x: window.innerWidth * camera.anchorX + (dx * cos - dy * sin) * camera.zoom,
      y: window.innerHeight * camera.anchorY + (dx * sin + dy * cos) * camera.zoom,
    };
  });

const selectTutorialTargetByPointer = async (page: Page): Promise<void> => {
  const point = await getTutorialTargetScreenPoint(page);
  expect(point).not.toBeNull();
  if (point !== null) {
    await page.mouse.click(point.x, point.y);
  }
  await expect.poll(
    async () => page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot().target?.kind ?? null),
  ).toBe('asteroid');
  await expect(page.getByTestId('target-panel')).toBeVisible();
};

test('mobile portrait supports station, targeting, joystick inertia, and tilt fallback', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-portrait', 'Mobile-only browser journey.');
  const errors = await waitForGame(page);

  await expect(page.getByTestId('station-panel')).toBeVisible();
  await expect(page.getByRole('heading', { name: "Miner's Rest" })).toBeVisible();
  await page.screenshot({ path: 'artifacts/screenshots/mobile-portrait-station.png', fullPage: true });

  await launch(page);
  await expectCameraAnchor(page, true);
  expect(await page.evaluate(() => window.__BELTER_DEBUG__?.getInputMode())).toBe('joystick');
  await expect(page.getByTestId('lateral-controls')).toBeVisible();
  await expect(page.getByText('HOLD MATCH')).toHaveCount(0);
  await selectTutorialTargetByPointer(page);
  await page.screenshot({ path: 'artifacts/screenshots/mobile-portrait-target-lock.png', fullPage: true });

  const pad = page.getByTestId('joystick-pad');
  const bounds = await pad.boundingBox();
  expect(bounds).not.toBeNull();
  if (bounds !== null) {
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX, centerY - bounds.height * 0.34, { steps: 4 });
    await page.waitForTimeout(650);
    await page.mouse.up();
  }
  const speedAtRelease = await page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot().ship.speed ?? 0);
  await page.waitForTimeout(420);
  const speedAfterCoasting = await page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot().ship.speed ?? 0);
  expect(speedAtRelease).toBeGreaterThan(2.5);
  expect(Math.abs(speedAfterCoasting - speedAtRelease)).toBeLessThan(0.12);

  const headingBeforeStrafe = await page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot().ship.heading ?? 0);
  const velocityBeforeStrafe = await page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot().ship.velocity.x ?? 0);
  const strafeRight = page.getByRole('button', { name: 'Strafe right' });
  const strafeBounds = await strafeRight.boundingBox();
  expect(strafeBounds).not.toBeNull();
  if (strafeBounds !== null) {
    await page.mouse.move(strafeBounds.x + strafeBounds.width / 2, strafeBounds.y + strafeBounds.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(320);
    expect(await page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot().appliedActions.strafe ?? 0)).toBeGreaterThan(0.9);
    await page.mouse.up();
  }
  const snapshotAfterStrafe = await page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot());
  expect(snapshotAfterStrafe?.ship.velocity.x ?? 0).toBeGreaterThan(velocityBeforeStrafe + 0.7);
  expect(snapshotAfterStrafe?.ship.heading ?? 1).toBeCloseTo(headingBeforeStrafe, 2);

  await page.getByRole('button', { name: 'Pause game' }).click();
  await page.locator('[data-control-mode="tilt"]').click();
  await expect.poll(
    async () => page.evaluate(() => window.__BELTER_DEBUG__?.getInputMode()),
    { timeout: 2_500 },
  ).toBe('joystick');

  expect(errors, `Browser runtime errors: ${errors.join(' | ')}`).toEqual([]);
});

test('mobile navigation lists independent ships and trackable massifs', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-portrait', 'Mobile navigation contact layout.');
  const errors = await waitForGame(page);
  await launch(page);
  await page.evaluate(() => window.__BELTER_DEBUG__?.advanceSimulation(8));
  await page.getByRole('button', { name: 'NAV' }).click();

  await expect(page.getByText('TRACKABLE CONTACTS')).toBeVisible();
  await expect(page.getByText('Free Trader Lark')).toBeVisible();
  await expect(page.getByText('RK-VL Atlas Massif')).toBeVisible();
  await page.getByText('Free Trader Lark').click();
  await expect.poll(
    async () => page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot().navigationBeacon?.kind),
  ).toBe('trader');
  await expect.poll(
    async () => page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot().autopilot.enabled ?? true),
  ).toBe(false);

  await page.getByRole('button', { name: 'NAV' }).click();
  await page.screenshot({ path: 'artifacts/screenshots/mobile-navigation-contacts.png', fullPage: true });
  expect(errors, `Browser runtime errors: ${errors.join(' | ')}`).toEqual([]);
});

test('desktop completes launch, mining, docking, sale, upgrade, and reload persistence', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-landscape', 'Desktop complete-loop journey.');
  const errors = await waitForGame(page);

  await expect(page.getByTestId('station-panel')).toBeVisible();
  await expect(page.locator('[data-module="engine-kestrel"]')).toBeVisible();
  await expect(page.locator('[data-module="flight-assist"]')).toBeVisible();
  await expect(page.locator('[data-module="flight-assist"] img')).toBeVisible();
  await page.screenshot({ path: 'artifacts/screenshots/desktop-landscape-station.png', fullPage: true });

  const baseSnapshot = await page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot());
  const baseThrust = baseSnapshot?.ship.forwardThrust ?? 0;
  await launch(page);
  await expectCameraAnchor(page, false);
  expect(await page.evaluate(() => window.__BELTER_DEBUG__?.getInputMode())).toBe('keyboard');

  await page.keyboard.down('KeyW');
  await page.waitForTimeout(650);
  await page.keyboard.up('KeyW');
  const speedAtRelease = await page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot().ship.speed ?? 0);
  await page.waitForTimeout(420);
  const speedAfterCoasting = await page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot().ship.speed ?? 0);
  expect(speedAtRelease).toBeGreaterThan(2.5);
  expect(Math.abs(speedAfterCoasting - speedAtRelease)).toBeLessThan(0.12);

  const headingBeforeStrafe = await page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot().ship.heading ?? 0);
  const velocityBeforeStrafe = await page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot().ship.velocity.x ?? 0);
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(320);
  expect(await page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot().appliedActions.strafe ?? 0)).toBeGreaterThan(0.9);
  await page.keyboard.up('KeyE');
  const snapshotAfterStrafe = await page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot());
  expect(snapshotAfterStrafe?.ship.velocity.x ?? 0).toBeGreaterThan(velocityBeforeStrafe + 0.7);
  expect(snapshotAfterStrafe?.ship.heading ?? 1).toBeCloseTo(headingBeforeStrafe, 2);
  await expect(page.getByText('HOLD MATCH')).toHaveCount(0);

  await selectTutorialTargetByPointer(page);
  await expect(page.getByTestId('context-actions').getByRole('button', { name: 'ASSIST LOCKED' })).toBeVisible();
  await page.getByTestId('context-actions').getByRole('button', { name: 'ASSIST LOCKED' }).click();
  await expect(page.getByText('ASSIST UPGRADE REQUIRED')).toBeVisible();
  await page.screenshot({ path: 'artifacts/screenshots/desktop-landscape-target-lock.png', fullPage: true });

  await page.evaluate(() => {
    const bridge = window.__BELTER_DEBUG__;
    bridge?.teleportNearTarget(28);
    bridge?.advanceSimulation(1.9);
  });
  await expect.poll(
    async () => page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot().ship.dronesDeployed ?? 0),
  ).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot().ship.cargoMass ?? -1)).toBe(0);
  await page.waitForTimeout(120);
  await page.screenshot({ path: 'artifacts/screenshots/desktop-drones-deployed.png', fullPage: true });

  await page.evaluate(() => {
    window.__BELTER_DEBUG__?.advanceSimulation(5.1);
  });
  await expect.poll(
    async () => page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot().ship.cargoMass ?? 0),
  ).toBeGreaterThanOrEqual(3);
  await page.screenshot({ path: 'artifacts/screenshots/desktop-mining.png', fullPage: true });

  await page.evaluate(() => {
    const bridge = window.__BELTER_DEBUG__;
    bridge?.recallDrones();
    bridge?.advanceSimulation(2);
  });
  await expect.poll(
    async () => page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot().ship.dronesDeployed ?? -1),
  ).toBe(0);

  await page.evaluate(() => {
    const bridge = window.__BELTER_DEBUG__;
    bridge?.prepareDocking();
    bridge?.advanceSimulation(2);
  });
  await expect.poll(
    async () => page.evaluate(() => window.__BELTER_DEBUG__?.isStationOpen() ?? false),
  ).toBe(true);
  await expect(page.getByTestId('station-panel')).toBeVisible();

  await page.getByRole('button', { name: 'Sell all cargo' }).click();
  await expect.poll(
    async () => page.evaluate(() => window.__BELTER_DEBUG__?.getCareer().credits ?? 0),
  ).toBeGreaterThanOrEqual(220);

  await page.locator('[data-module-id="flight-assist"]').click();
  await expect.poll(
    async () => page.evaluate(() => window.__BELTER_DEBUG__?.getCareer().installedModules.includes('flight-assist') ?? false),
  ).toBe(true);
  const upgraded = await page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot());
  expect(upgraded?.autopilotAvailable).toBe(true);
  expect(upgraded?.ship.forwardThrust ?? 0).toBeCloseTo(baseThrust);
  expect(upgraded?.ship.installedModules).toContain('flight-assist');
  expect(Object.values(upgraded?.ship.hardpoints ?? {}).some(
    (hardpoint) => hardpoint.moduleId === 'flight-assist',
  )).toBe(false);
  await page.screenshot({ path: 'artifacts/screenshots/desktop-upgrade-installed.png', fullPage: true });

  await bootInlineGame(page);
  await expect(page.getByTestId('station-panel')).toBeVisible();
  const persisted = await page.evaluate(() => ({
    career: window.__BELTER_DEBUG__?.getCareer(),
    ship: window.__BELTER_DEBUG__?.getSnapshot().ship,
  }));
  expect(persisted.career?.installedModules).toContain('flight-assist');
  expect(persisted.career?.tutorialComplete).toBe(true);
  expect(persisted.ship?.forwardThrust ?? 0).toBeCloseTo(baseThrust);

  await launch(page);
  await page.evaluate(() => {
    const bridge = window.__BELTER_DEBUG__;
    bridge?.selectTutorialTarget();
    bridge?.teleportNearTarget(100);
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'artifacts/screenshots/desktop-upgraded-flight.png', fullPage: true });

  await page.evaluate(() => {
    const bridge = window.__BELTER_DEBUG__;
    const career = bridge?.getCareer();
    if (career === undefined || bridge === undefined) {
      return;
    }
    bridge.destroy();
    career.credits = 9999;
    career.ownedModules = ['mining-drone', 'engine-kestrel', 'retro-brace', 'cargo-saddles', 'flight-assist'];
    career.hardpointLoadout = {
      port: 'engine-kestrel',
      starboard: 'retro-brace',
      ventral: 'cargo-saddles',
    };
    career.hardpointCondition = { port: 100, starboard: 100, ventral: 100 };
    career.installedModules = ['engine-kestrel', 'retro-brace', 'cargo-saddles'];
    localStorage.setItem('project-belter.career.v1', JSON.stringify(career));
  });
  await bootInlineGame(page);
  await expect(page.locator('.module-card[data-installed="true"]')).toHaveCount(4);
  await page.screenshot({ path: 'artifacts/screenshots/desktop-all-upgrades-station.png', fullPage: true });
  await launch(page);
  await page.evaluate(() => {
    const bridge = window.__BELTER_DEBUG__;
    bridge?.selectTutorialTarget();
    bridge?.teleportNearTarget(100);
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'artifacts/screenshots/desktop-all-upgrades-flight.png', fullPage: true });

  expect(errors, `Browser runtime errors: ${errors.join(' | ')}`).toEqual([]);
});

test('desktop autopilot crosses the live asteroid field without damage', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-landscape', 'Desktop autopilot journey.');
  const errors = await waitForGame(page);
  await page.evaluate(() => {
    const bridge = window.__BELTER_DEBUG__;
    const career = bridge?.getCareer();
    if (bridge === undefined || career === undefined) {
      return;
    }
    bridge.destroy();
    career.ownedModules.push('flight-assist');
    career.installedModules.push('flight-assist');
    localStorage.setItem('project-belter.career.v1', JSON.stringify(career));
  });
  await bootInlineGame(page);
  await launch(page);

  await page.getByRole('button', { name: 'NAV' }).click();
  await expect(page.getByTestId('navigation-panel')).toHaveAttribute('aria-hidden', 'false');
  await page.locator('[data-navigation-id="pallas-gate"]').first().click();
  await expect.poll(
    async () => page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot().autopilot.enabled ?? true),
  ).toBe(false);
  await page.getByRole('button', { name: 'NAV' }).click();
  await page.getByRole('button', { name: 'Engage autopilot' }).click();
  await expect.poll(
    async () => page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot().autopilot.enabled ?? false),
  ).toBe(true);

  await page.evaluate(() => window.__BELTER_DEBUG__?.advanceSimulation(24));
  const crossing = await page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot());
  expect(crossing?.autopilot.enabled).toBe(true);
  expect(crossing?.ship.hull).toBe(100);
  expect(crossing?.ship.speed ?? 0).toBeGreaterThan(15);
  await page.screenshot({ path: 'artifacts/screenshots/desktop-autopilot-avoidance.png', fullPage: true });

  for (let segment = 0; segment < 12; segment += 1) {
    const phase = await page.evaluate(() => {
      window.__BELTER_DEBUG__?.advanceSimulation(15);
      return window.__BELTER_DEBUG__?.getSnapshot().phase;
    });
    if (phase === 'station') {
      break;
    }
  }

  const arrived = await page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot());
  expect(arrived?.phase).toBe('station');
  expect(arrived?.dockedStation.destinationId).toBe('pallas-gate');
  expect(arrived?.ship.hull).toBe(100);
  expect(errors, `Browser runtime errors: ${errors.join(' | ')}`).toEqual([]);
});

test('desktop manual navigation retires waypoints immediately after they are passed', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-landscape', 'Desktop navigation-guide regression.');
  const errors = await waitForGame(page);
  await launch(page);

  const route = await page.evaluate(() => {
    const bridge = window.__BELTER_DEBUG__;
    bridge?.selectNavigationDestination('pallas-gate');
    bridge?.advanceSimulation(0.1);
    return bridge?.getSnapshot();
  });
  const firstWaypoint = route?.autopilot.path[0];
  expect(firstWaypoint).toBeDefined();
  expect(route?.autopilot.enabled).toBe(false);
  if (firstWaypoint === undefined || route === undefined) {
    return;
  }

  const origin = route.ship.position;
  const legX = firstWaypoint.x - origin.x;
  const legY = firstWaypoint.y - origin.y;
  const legLength = Math.hypot(legX, legY);
  const directionX = legX / legLength;
  const directionY = legY / legLength;
  await page.evaluate(({ waypoint, x, y }) => {
    const bridge = window.__BELTER_DEBUG__;
    bridge?.setShipPosition({
      x: waypoint.x + x,
      y: waypoint.y + y,
    });
    bridge?.setShipVelocity({ x: 0, y: 0 });
    bridge?.advanceSimulation(0.1);
  }, {
    waypoint: firstWaypoint,
    x: directionX * 20 - directionY * 90,
    y: directionY * 20 + directionX * 90,
  });

  const progressed = await page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot());
  expect(progressed?.autopilot.enabled).toBe(false);
  expect(progressed?.autopilot.path[0]).not.toEqual(firstWaypoint);
  await page.screenshot({ path: 'artifacts/screenshots/desktop-manual-waypoint-progress.png', fullPage: true });
  expect(errors, `Browser runtime errors: ${errors.join(' | ')}`).toEqual([]);
});

test('desktop sector map shows the diagonal belt, relocated stations, and trader transit', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-landscape', 'Desktop sector-map visual check.');
  const errors = await waitForGame(page);
  await launch(page);
  await page.evaluate(() => window.__BELTER_DEBUG__?.advanceSimulation(8));

  await page.getByRole('button', { name: 'NAV' }).click();
  await expect(page.getByTestId('navigation-panel')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('.navigation-belt-band')).toBeVisible();

  const ceres = page.locator('[data-navigation-id="ceres-relay"]').first();
  const pallas = page.locator('[data-navigation-id="pallas-gate"]').first();
  expect(parseFloat(await ceres.evaluate((element) => element.style.left))).toBeCloseTo(68.75, 2);
  expect(parseFloat(await ceres.evaluate((element) => element.style.top))).toBeCloseTo(86.46, 2);
  expect(parseFloat(await pallas.evaluate((element) => element.style.left))).toBeCloseTo(14.58, 2);
  expect(parseFloat(await pallas.evaluate((element) => element.style.top))).toBeCloseTo(18.75, 2);

  const traderMarker = page.locator('#navigation-trader-marker');
  await expect(traderMarker).toHaveAttribute('data-visible', '');
  await expect(traderMarker).toContainText('TRANSIT');
  await traderMarker.click();
  await expect.poll(
    async () => page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot().navigationBeacon?.kind),
  ).toBe('trader');
  await expect.poll(
    async () => page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot().autopilot.enabled ?? true),
  ).toBe(false);

  await page.getByRole('button', { name: 'NAV' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'artifacts/screenshots/desktop-sector-map.png', fullPage: true });
  await page.getByRole('button', { name: 'Close' }).click();
  await page.evaluate(() => {
    const trader = window.__BELTER_DEBUG__?.getSnapshot().traders[0];
    if (trader !== undefined) {
      window.__BELTER_DEBUG__?.setShipPosition({
        x: trader.position.x - 125,
        y: trader.position.y + 20,
      });
      window.__BELTER_DEBUG__?.setShipVelocity({ x: 0, y: 0 });
    }
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'artifacts/screenshots/desktop-trader-target.png', fullPage: true });
  await page.evaluate(() => {
    window.__BELTER_DEBUG__?.setShipPosition({ x: 0, y: 0 });
    window.__BELTER_DEBUG__?.setShipVelocity({ x: 0, y: 0 });
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'artifacts/screenshots/desktop-belt-centre.png', fullPage: true });
  await page.evaluate(() => {
    window.__BELTER_DEBUG__?.setShipPosition({ x: -1_050, y: 1_000 });
    window.__BELTER_DEBUG__?.setShipVelocity({ x: 0, y: 0 });
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'artifacts/screenshots/desktop-belt-corner.png', fullPage: true });
  expect(errors, `Browser runtime errors: ${errors.join(' | ')}`).toEqual([]);
});
