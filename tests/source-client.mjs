import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { PNG } from 'pngjs';
import WebSocket from 'ws';

const base = (process.env.MIR_URL ?? 'http://127.0.0.1:18883').replace(/\/$/, '');
const destination = process.env.MIR_SOURCE_REPORT ?? '.runtime/reports/source-client';
const scope = process.env.MIR_SOURCE_SCOPE ?? 'all';
assert.ok(['all', 'warehouse'].includes(scope), 'Unknown source test scope');
await mkdir(destination, { recursive: true });
await mkdir('.state', { recursive: true });
const report = { checkedAt: new Date().toISOString(), url: base, scope, passed: false, full176Acceptance: false, jobs: [] };
const browser = await chromium.launch({ headless: true });
const observed = page => page.evaluate(() => window.__mir2Agent.snapshot());
let activePage;
async function enter(page, credentials, register = false) {
  await page.goto(`${base}/?agent=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__mir2Agent, {}, { timeout: 60000 });
  await page.locator('#account').fill(credentials.account);
  await page.locator('#password').fill(credentials.password);
  await page.locator(register ? '#register' : '#auth-login-ok').click();
  await expect(page.locator('[data-auth-select]')).toBeVisible({ timeout: 30000 });
}
async function world(page) {
  await page.locator('[data-auth-start]').click();
  await expect.poll(async () => {
    const state = await observed(page);
    return state.worldReady && state.inventory.known && state.attributes?.level === 1 && state.render?.framesReady;
  }, { timeout: 60000 }).toBeTruthy();
}
function sampledColors(bytes) {
  const image = PNG.sync.read(bytes), colors = new Set();
  for (let y = 0; y < image.height; y += 7) for (let x = 0; x < image.width; x += 7) {
    const i = (y * image.width + x) * 4;
    colors.add(image.data.subarray(i, i + 3).toString('hex'));
  }
  return colors.size;
}
async function openWarehouse(page) {
  await page.locator('[data-window-open="targets"]').click();
  await page.locator('#nearby-targets').getByRole('button', { name: /^边界村保管员/ }).click();
  await expect(page.locator('#npc-dialog')).toBeVisible({ timeout: 30000 });
}
try {
  assert.equal((await fetch(`${base}/missing-asset-probe.json`)).status, 404);
  const forbidden = await new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws', { origin: 'http://untrusted.invalid' });
    const timeout = setTimeout(() => { ws.terminate(); reject(new Error('Origin rejection timed out')); }, 10000);
    ws.once('unexpected-response', (_, response) => { clearTimeout(timeout); response.resume(); ws.terminate(); resolve(response.statusCode); });
    ws.once('open', () => { clearTimeout(timeout); ws.close(); reject(new Error('Untrusted Origin accepted')); });
    ws.on('error', () => {});
  });
  assert.equal(forbidden, 403);
  report.originRejected = true;
  for (const job of scope === 'all' ? [0, 1, 2] : []) {
    const credentials = { account: `s${String(Date.now()).slice(-7)}${job}`, password: 'Source987', character: `src${String(Date.now()).slice(-6)}${job}` };
    await writeFile(`.state/source-client-${job}.json`, JSON.stringify(credentials), { mode: 0o600 });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    activePage = page;
    const errors = [], missing = [], loadedActors = new Set();
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      const path = new URL(response.url()).pathname;
      if (response.status() >= 400) missing.push({ path, status: response.status() });
      if (response.ok() && /\/actors\/.+\.png$/.test(path)) loadedActors.add(path.split('/')[2]);
    });
    await enter(page, credentials, true);
    await expect(page.locator('#auth-overlay')).toHaveClass(/national-auth/);
    await page.locator('[data-auth-new]').click();
    await page.locator('#character-name').fill(credentials.character);
    await page.locator(`[data-auth-job="${job}"]`).click();
    await page.locator(`[data-auth-sex="${job === 1 ? 1 : 0}"]`).click();
    await page.locator('#auth-create-ok').click();
    await expect(page.locator('[data-auth-select]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#characters')).toContainText(credentials.character);
    await page.waitForTimeout(1200);
    await world(page);
    let state = await observed(page);
    assert.equal(state.map, '0');
    assert.equal(state.attributes.job, job);
    assert.equal(state.attributes.gold, 0);
    assert.ok(state.inventory.items.some(item => item.name === '木剑'));
    assert.equal(state.minimap.imageReady, true);
    await expect(page.locator('#status')).toContainText('0 个未解析引用');
    await expect(page.locator('#classic-hud')).toHaveClass(/national-ui/);
    await expect(page.locator('.hud-orb-well.hp')).toHaveAttribute('data-red-only', String(job === 0));
    await page.keyboard.press('F9');
    await page.locator('#inventory-items').getByRole('button', { name: '木剑', exact: true }).dblclick();
    await expect.poll(async () => (await observed(page)).equipment.slots.some(slot => slot.item.name === '木剑'), { timeout: 15000 }).toBe(true);
    const clothes = job === 1 ? '布衣(女)' : '布衣(男)';
    await page.locator('#inventory-items').getByRole('button', { name: clothes, exact: true }).dblclick();
    await expect.poll(async () => (await observed(page)).equipment.slots.some(slot => slot.item.name === clothes), { timeout: 15000 }).toBe(true);
    await page.keyboard.press('F9');
    state = await observed(page);
    const before = state.self;
    const keys = { 0: 'ArrowUp', 2: 'ArrowRight', 4: 'ArrowDown', 6: 'ArrowLeft' };
    let moved = false;
    for (const direction of state.directions.filter(value => value.clearSteps > 0 && keys[value.direction])) {
      await page.keyboard.press(keys[direction.direction]);
      try {
        await expect.poll(async () => {
          const after = await observed(page);
          return !after.pending && (after.self.x !== before.x || after.self.y !== before.y);
        }, { timeout: 3500 }).toBe(true);
        moved = true;
        break;
      } catch { /* A server actor may occupy a cell between the snapshot and input. */ }
    }
    assert.equal(moved, true);
    const timeline = await page.evaluate(() => window.__mir2Agent.events());
    assert.ok(timeline.some(event => event.type === 'gateway-in' && event.data.type === 'actionResult' && event.data.accepted === true));
    await page.waitForTimeout(1500);
    await expect.poll(async () => (await observed(page)).render.framesReady, { timeout: 15000 }).toBe(true);
    const colors = sampledColors(await page.locator('#viewport canvas').screenshot());
    assert.ok(colors > 35, `Blank canvas: ${colors} sampled colors`);
    await page.screenshot({ path: `${destination}/job-${job}-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(800);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const mobileColors = sampledColors(await page.locator('#viewport canvas').screenshot());
    assert.ok(mobileColors > 35);
    await page.screenshot({ path: `${destination}/job-${job}-mobile.png` });
    const saved = await observed(page);
    assert.deepEqual(errors, []);
    assert.deepEqual(missing, []);
    assert.ok(loadedActors.has('BichonMonster5'), 'Scarecrow must load real frames');
    await page.close();
    await new Promise(resolve => setTimeout(resolve, 1600));
    const returning = await browser.newPage();
    activePage = returning;
    await enter(returning, credentials);
    await world(returning);
    const resumed = await observed(returning);
    assert.deepEqual({ x: resumed.self.x, y: resumed.self.y }, { x: saved.self.x, y: saved.self.y });
    assert.ok(resumed.equipment.slots.some(slot => slot.item.name === '木剑'));
    assert.ok(resumed.equipment.slots.some(slot => slot.item.name === clothes));
    await returning.close();
    report.jobs.push({ job, browserRegistrationAndCreation: true, level: 1, gold: 0, equipment: ['木剑', clothes], acknowledgedMovement: true, equipmentAndPositionPersisted: true, minimapReady: true, unresolvedMapReferences: 0, desktopColors: colors, mobileColors, mobileOverflow: false, loadedActorLibraries: [...loadedActors].sort(), errors, missingResources: missing });
    console.log(`PASS source client job ${job}: registration, rendering, equipment, movement and reconnect persistence.`);
  }
  const credentials = JSON.parse(await readFile('.state/source-client-0.json', 'utf8'));
  const warehouseErrors = [], warehouseMissing = [];
  function watchWarehouse(page) {
    page.on('pageerror', error => warehouseErrors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) warehouseMissing.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  }
  const storagePage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watchWarehouse(storagePage);
  activePage = storagePage;
  await enter(storagePage, credentials);
  await world(storagePage);
  if ((await observed(storagePage)).map === '0') {
  const map = (await observed(storagePage)).minimap;
  const mini = storagePage.locator('#mini-map'), box = await mini.boundingBox();
  const size = await mini.evaluate(element => ({ width: element.clientWidth, height: element.clientHeight }));
  await storagePage.mouse.click(box.x + (map.drawRect.left + 307 / (map.world.width - 1) * map.drawRect.width) * box.width / size.width, box.y + (map.drawRect.top + 627 / (map.world.height - 1) * map.drawRect.height) * box.height / size.height);
  await expect.poll(async () => {
    const state = await observed(storagePage);
    if (state.self?.hp !== undefined) assert.ok(state.self.hp > 0, 'Warehouse walk killed the player');
    return state.worldReady && state.map === '0140' && !!state.self && state.render?.framesReady;
  }, { timeout: 90000 }).toBe(true);
  }
  assert.equal((await observed(storagePage)).map, '0140');
  await expect.poll(async () => (await observed(storagePage)).nearby.some(entity => entity.name === '边界村保管员'), { timeout: 15000 }).toBe(true);
  const warehouseNpc = (await observed(storagePage)).nearby.find(entity => entity.name === '边界村保管员');
  assert.ok(warehouseNpc.distance > 1 && warehouseNpc.distance <= 15, 'Counter NPC must be reachable from the entrance');
  await expect(storagePage.locator('#status')).toContainText('0 个未解析引用', { timeout: 15000 });
  const warehouseMap = await (await fetch(`${base}/maps/0140/map.json`)).json();
  assert.deepEqual(warehouseMap.objectLibraries, { 1: 'Room0140Objects2', 2: 'Room0140Objects3' });
  await openWarehouse(storagePage);
  await storagePage.locator('#npc-options').getByRole('button', { name: '找回', exact: true }).click();
  await expect(storagePage.locator('#storage-panel')).toContainText('仓库为空');
  await storagePage.locator('#storage-panel .classic-window-close').click();
  await openWarehouse(storagePage);
  await storagePage.locator('#npc-options').getByRole('button', { name: '保管', exact: true }).click();
  const candle = (await observed(storagePage)).inventory.items.find(item => item.name === '蜡烛');
  assert.ok(candle);
  await storagePage.locator(`[data-storage-item="${candle.makeIndex}"]`).getByRole('button', { name: '存入', exact: true }).click();
  await expect.poll(async () => (await observed(storagePage)).inventory.items.some(item => item.makeIndex === candle.makeIndex), { timeout: 15000 }).toBe(false);
  await storagePage.screenshot({ path: `${destination}/warehouse-deposit.png` });
  await storagePage.close();
  await new Promise(resolve => setTimeout(resolve, 1600));
  const taking = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watchWarehouse(taking);
  activePage = taking;
  await enter(taking, credentials);
  await world(taking);
  assert.equal((await observed(taking)).map, '0140');
  await openWarehouse(taking);
  await taking.locator('#npc-options').getByRole('button', { name: '找回', exact: true }).click();
  await expect(taking.locator(`[data-storage-item="${candle.makeIndex}"]`)).toContainText('蜡烛');
  await taking.locator(`[data-storage-item="${candle.makeIndex}"]`).getByRole('button', { name: '取回', exact: true }).click();
  await expect.poll(async () => (await observed(taking)).inventory.items.some(item => item.makeIndex === candle.makeIndex), { timeout: 15000 }).toBe(true);
  assert.equal((await observed(taking)).attributes.gold, 0);
  await taking.screenshot({ path: `${destination}/warehouse-withdrawal.png` });
  await taking.close();
  assert.deepEqual(warehouseErrors, []);
  assert.deepEqual(warehouseMissing, []);
  report.warehouse = { browserEntrance: true, counterNpcDistance: warehouseNpc.distance, objectLibraries: warehouseMap.objectLibraries, emptyList: true, deposit: true, reconnectWithdrawal: true, sameItemInstance: true, goldPreserved: true, errors: warehouseErrors, missingResources: warehouseMissing };
  console.log('PASS source client warehouse: entrance, empty list, deposit and withdrawal after reconnect.');
  report.passed = true;
} catch (error) {
  report.error = error.stack;
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: `${destination}/failure.png` }).catch(() => {});
    const state = await observed(activePage).catch(() => undefined);
    report.failureState = state && { map: state.map, worldReady: state.worldReady, attributes: state.attributes, render: state.render, authScene: state.authScene, connection: state.connection };
  }
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(`${destination}/evidence.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
