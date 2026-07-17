import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('root standalone build launches and supports lateral keyboard thrust', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-landscape', 'One exact-file check is sufficient.');
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  const standaloneUrl = pathToFileURL(
    resolve(process.cwd(), 'project-belter-vertical-slice-standalone.html'),
  ).href;
  await page.goto(standaloneUrl, { waitUntil: 'load' });
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForFunction(() => window.__BELTER_DEBUG__ !== undefined);
  await expect(page.getByText('HOLD MATCH')).toHaveCount(0);

  await page.getByRole('button', { name: 'Launch expedition' }).click();
  await expect.poll(
    async () => page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot().phase),
  ).toBe('flight');

  const before = await page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot());
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(320);
  expect(
    await page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot().appliedActions.strafe ?? 0),
  ).toBeGreaterThan(0.9);
  await page.keyboard.up('KeyE');
  const after = await page.evaluate(() => window.__BELTER_DEBUG__?.getSnapshot());
  expect(after?.ship.velocity.x ?? 0).toBeGreaterThan((before?.ship.velocity.x ?? 0) + 0.7);
  expect(after?.ship.heading ?? 1).toBeCloseTo(before?.ship.heading ?? 0, 2);

  const textState = await page.evaluate(() => window.render_game_to_text?.() ?? '');
  const parsedState = JSON.parse(textState) as { mode?: string; coordinateSystem?: string };
  expect(parsedState.mode).toBe('flight');
  expect(parsedState.coordinateSystem).toContain('+x right');
  await page.screenshot({ path: 'artifacts/screenshots/desktop-standalone-flight.png', fullPage: true });
  expect(pageErrors, `Standalone runtime errors: ${pageErrors.join(' | ')}`).toEqual([]);
});
