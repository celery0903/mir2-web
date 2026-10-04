import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {chromium, expect} from '@playwright/test';
import {PNG} from 'pngjs';

const credentials = JSON.parse(await readFile(process.env.MIR_EMPTY_CREDENTIALS ?? '.state/source-status-services-dead.json'));
const previous = JSON.parse(await readFile(process.env.MIR_EMPTY_PREVIOUS ?? 'docs/correction/source-status-empty-bag-login-failure.json'));
const base = (process.env.MIR_URL ?? 'http://127.0.0.1:18883').replace(/\/$/, '');
const destination = process.env.MIR_EMPTY_REPORT ?? '.runtime/reports/source-status-empty-inventory';
assert.equal(credentials.url, base);
assert.equal(previous.url, base);
assert.equal(previous.state.inventory.known, false);
assert.deepEqual(previous.state.inventory.items, []);
const expectedWeapon = previous.state.equipment.slots.find(slot => slot.item.name === '木剑').item;
await mkdir(destination, {recursive: true});
const report = {checkedAt: new Date().toISOString(), url: base, passed: false, full176Acceptance: false,
  scope: 'Reuses the previously failing empty-bag character without database or item changes; verifies native empty inventory and preserved equipment on desktop/mobile login.',
  logins: [], errors: [], missingResources: []};
const browser = await chromium.launch({headless: true});
try {
  for (const [name, viewport] of [['desktop', {width: 1440, height: 900}], ['mobile', {width: 390, height: 844}]]) {
    const page = await browser.newPage({viewport}), inventories = [];
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400) report.missingResources.push({path: new URL(response.url()).pathname, status: response.status()});
    });
    page.on('websocket', socket => socket.on('framereceived', frame => {
      const message = JSON.parse(String(frame.payload)).message;
      if (message?.type === 'inventory') inventories.push(message);
    }));
    await page.goto(`${base}/?agent=1`, {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => !!window.__mir2Agent, {}, {timeout: 60000});
    await page.locator('#account').fill(credentials.account);
    await page.locator('#password').fill(credentials.password);
    await page.locator('#auth-login-ok').click();
    await expect(page.locator('[data-auth-select]')).toBeVisible({timeout: 30000});
    await page.waitForTimeout(1200);
    await page.locator('[data-auth-start]').click();
    await expect.poll(() => page.evaluate(() => {
      const state = window.__mir2Agent.snapshot();
      return state.worldReady && state.inventory.known && state.render?.framesReady;
    }), {timeout: 60000}).toBe(true);
    const state = await page.evaluate(() => window.__mir2Agent.snapshot());
    assert.ok(state.self.hp > 0);
    assert.deepEqual(state.inventory.items, []);
    assert.ok(inventories.some(message => message.items.length === 0), 'No authoritative empty inventory packet');
    assert.equal(state.attributes.level, 1);
    assert.equal(state.attributes.gold, previous.state.attributes.gold);
    const weapon = state.equipment.slots.find(slot => slot.item.makeIndex === expectedWeapon.makeIndex)?.item;
    assert.ok(weapon, 'Login lost the previously equipped sword');
    assert.equal(weapon.durability, expectedWeapon.durability);
    assert.equal(weapon.maxDurability, expectedWeapon.maxDurability);
    await page.keyboard.press('F9');
    await expect(page.locator('#inventory-window')).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const screenshot = `${destination}/${name}.png`;
    const png = PNG.sync.read(await page.screenshot({path: screenshot}));
    const colors = new Set();
    for (let y = 0; y < png.height; y += 7) for (let x = 0; x < png.width; x += 7) {
      const at = (y * png.width + x) * 4;
      colors.add(png.data.subarray(at, at + 3).toString('hex'));
    }
    assert.ok(colors.size > 100, 'Blank game screenshot');
    report.logins.push({viewport: name, map: state.map, hp: state.self.hp, inventoryKnown: true, authoritativeEmptyPacket: true,
      equippedSword: {makeIndex: weapon.makeIndex, durability: weapon.durability, maxDurability: weapon.maxDurability}, gold: state.attributes.gold, screenshot, sampledColors: colors.size});
    await page.close();
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.missingResources, []);
  report.passed = true;
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  await browser.close();
  await writeFile(`${destination}/evidence.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
