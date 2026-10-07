import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';

const base = (process.env.MIR_URL ?? 'http://172.30.0.16:18880').replace(/\/$/, '');
const destination = resolve(process.env.MIR_CONCURRENT_REPORT ?? '.runtime/reports/concurrent-login');
const suffix = String(Date.now()).slice(-6);
const accounts = [0, 1, 2].map(job => ({ job, account: `cq${suffix}${job}`, character: `cq${suffix}${job}`, password: randomBytes(5).toString('hex') }));
await mkdir(destination, { recursive: true });
await mkdir('.state', { recursive: true });
await writeFile(`.state/source-concurrent-${suffix}.json`, JSON.stringify(accounts), { mode: 0o600 });
const report = { checkedAt: new Date().toISOString(), url: base, passed: false, full176Acceptance: false,
  scope: 'Three ordinary browser-created characters, one per job, enter together for three rounds. No offline fixtures.',
  rounds: [], errors: [], missingResources: [], receivedTypes: [] };
const browser = await chromium.launch({ headless: true });
let pages = [];
const snapshot = page => page.evaluate(() => window.__mir2Agent.snapshot());
async function prepare(account, register, round) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  pages.push(page);
  page.on('pageerror', error => report.errors.push({ round, job: account.job, message: error.message }));
  page.on('response', response => { if (response.status() >= 400) report.missingResources.push({ round, job: account.job,
    path: new URL(response.url()).pathname, status: response.status() }); });
  page.on('websocket', socket => socket.on('framereceived', frame => {
    const message = JSON.parse(String(frame.payload)).message;
    if (message) report.receivedTypes.push({ round, job: account.job, type: message.type });
  }));
  await page.goto(`${base}/?agent=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__mir2Agent, {}, { timeout: 60000 });
  await page.locator('#account').fill(account.account);
  await page.locator('#password').fill(account.password);
  await page.locator(register ? '#register' : '#auth-login-ok').click();
  await expect(page.locator('[data-auth-select]')).toBeVisible({ timeout: 30000 });
  if (register) {
    await page.locator('[data-auth-new]').click();
    await page.locator('#character-name').fill(account.character);
    await page.locator(`[data-auth-job="${account.job}"]`).click();
    await page.locator('#auth-create-ok').click();
    await expect(page.locator('[data-auth-select]')).toBeVisible({ timeout: 30000 });
  }
  await page.waitForTimeout(1200);
  return page;
}
try {
  for (let round = 0; round < 3; round++) {
    pages = [];
    // Register first, then issue all game-entry clicks together without retrying failures.
    if (round === 0) for (const account of accounts) await prepare(account, true, round);
    else await Promise.all(accounts.map(account => prepare(account, false, round)));
    const byJob = await Promise.all(pages.map(async page => ({ page, name: await page.locator('#characters').textContent() })));
    const entered = await Promise.all(accounts.map(async account => {
      const page = byJob.find(entry => entry.name.includes(account.character))?.page;
      assert.ok(page, 'Prepared character selection is missing');
      await page.locator('[data-auth-start]').click();
      await expect.poll(async () => {
        const state = await snapshot(page);
        return state.inWorld && state.worldReady && state.inventory.known && state.render?.framesReady
          && (state.map !== '0' || state.minimap.imageReady);
      }, { timeout: 60000 }).toBe(true);
      const state = await snapshot(page);
      assert.equal(state.attributes.level, 1);
      assert.equal(state.attributes.gold, 0);
      assert.equal(state.attributes.job, account.job);
      return { job: account.job, character: account.character, map: state.map, x: state.self.x, y: state.self.y,
        actorId: state.self.id, nativeInventoryKnown: state.inventory.known };
    }));
    assert.equal(new Set(entered.map(player => player.actorId)).size, 3);
    report.rounds.push({ round, allThreeEntered: true, players: entered });
    if (round === 2) {
      await pages[0].screenshot({ path: join(destination, 'concurrent-desktop.png') });
      await pages[1].setViewportSize({ width: 390, height: 844 });
      assert.equal(await pages[1].evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await pages[1].screenshot({ path: join(destination, 'concurrent-mobile.png') });
    }
    await Promise.all(pages.map(page => page.close()));
    await delay(1500);
    console.log(`Three concurrent native game entries passed in round ${round + 1}/3.`);
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.missingResources, []);
  report.passed = true;
} catch (error) {
  report.error = String(error);
  for (const [index, page] of pages.entries()) if (!page.isClosed()) {
    try { report[`state${index}`] = await snapshot(page); await page.screenshot({ path: join(destination, `failure-${index}.png`) }); }
    catch {}
  }
  process.exitCode = 1;
  console.error(report.error);
} finally {
  await browser.close();
  await writeFile(join(destination, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
}
