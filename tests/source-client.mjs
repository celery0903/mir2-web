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
let closingBrowser = false;
browser.on('disconnected', () => { if (!closingBrowser) report.unexpectedBrowserDisconnect = new Date().toISOString(); });
const observed = page => page.evaluate(() => window.__mir2Agent.snapshot());
let activePage;
let activeDiagnostics;
async function enter(page, credentials, register = false) {
  const diagnostics = { stage: 'bootstrap', errors: [], missingResources: [], failedRequests: [], crashes: [] };
  activeDiagnostics = diagnostics;
  page.on('crash', () => diagnostics.crashes.push(new Date().toISOString()));
  page.on('pageerror', error => diagnostics.errors.push(error.message));
  page.on('requestfailed', request => diagnostics.failedRequests.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }));
  page.on('response', response => { if (response.status() >= 400) diagnostics.missingResources.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  await page.goto(`${base}/?agent=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__mir2Agent, {}, { timeout: 60000 });
  diagnostics.stage = register ? 'registration' : 'login';
  await page.locator('#account').fill(credentials.account);
  await page.locator('#password').fill(credentials.password);
  await page.locator(register ? '#register' : '#auth-login-ok').click();
  await expect(page.locator('[data-auth-select]')).toBeVisible({ timeout: 30000 });
  diagnostics.stage = 'character-selection';
}
async function world(page) {
  activeDiagnostics.stage = 'world-entry';
  await page.locator('[data-auth-start]').click();
  await expect.poll(async () => {
    const state = await observed(page);
    return state.worldReady && state.inventory.known && state.attributes?.level === 1 && state.render?.framesReady && (state.map !== '0' || state.minimap.imageReady);
  }, { timeout: 60000 }).toBeTruthy();
  activeDiagnostics.stage = 'gameplay';
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
  if(await page.locator('#npc-dialog').isVisible())await page.locator('#close-dialogue').click();
  await page.locator('[data-window-open="targets"]').click();
  await page.locator('#nearby-targets').getByRole('button', { name: /^边界村保管员/ }).click();
  await expect(page.locator('#npc-dialog')).toBeVisible({ timeout: 30000 });
}
async function walkToMap(page,x,y,target){
 const map=(await observed(page)).minimap,mini=page.locator('#mini-map'),box=await mini.boundingBox();
 const size=await mini.evaluate(element=>({width:element.clientWidth,height:element.clientHeight}));
 await page.mouse.click(box.x+(map.drawRect.left+x/(map.world.width-1)*map.drawRect.width)*box.width/size.width,box.y+(map.drawRect.top+y/(map.world.height-1)*map.drawRect.height)*box.height/size.height);
 await expect.poll(async()=>{const state=await observed(page);if(state.self?.hp!==undefined)assert.ok(state.self.hp>0,'Warehouse walk killed the player');return state.worldReady&&state.map===target&&!!state.self&&state.render?.framesReady;},{timeout:90000}).toBe(true);
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
  for (const job of scope === 'all' ? [0, 1, 2] : [0]) {
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
    assert.ok([...loadedActors].some(name=>/^BichonMonster(?:[3-9]|1[0-2])$/.test(name)), 'Nearby wildlife must load mapped classic frames');
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
  if((await observed(storagePage)).map==='0140')await walkToMap(storagePage,2,11,'0');
  await walkToMap(storagePage,307,627,'0140');
  assert.equal((await observed(storagePage)).map, '0140');
  await expect.poll(async () => (await observed(storagePage)).nearby.some(entity => entity.name === '边界村保管员'), { timeout: 15000 }).toBe(true);
  const warehouseNpc = (await observed(storagePage)).nearby.find(entity => entity.name === '边界村保管员');
  assert.ok(warehouseNpc.distance > 1 && warehouseNpc.distance <= 15, 'Counter NPC must be reachable from the entrance');
  await expect(storagePage.locator('#status')).toContainText('0 个未解析引用', { timeout: 15000 });
  const warehouseMap = await (await fetch(`${base}/maps/0140/map.json`)).json();
  if (warehouseMap.resourceNamespace === 'WemadeMir2') {
    const native = JSON.parse(await readFile('shared/native-world.lock.json'));
    assert.equal(warehouseMap.sourceSha256, native.maps.find(map => map.id === '0140').sha256);
    assert.deepEqual(warehouseMap.objectLibraries, { 1: 'WemadeObjects2', 2: 'WemadeObjects3' });
  } else assert.deepEqual(warehouseMap.objectLibraries, { 1: 'Room0140Objects2', 2: 'Room0140Objects3' });
  await openWarehouse(storagePage);
  await expect(storagePage.locator('#npc-dialog')).toHaveClass(/inline-dialogue/);
  await expect(storagePage.locator('#npc-text .npc-line').filter({has:storagePage.getByRole('button',{name:'保管',exact:true})})).toHaveText('保管东西');
  await expect(storagePage.locator('#npc-dialog')).toHaveCSS('width','416px');
  await expect(storagePage.locator('#npc-dialog')).toHaveCSS('height','176px');
  await storagePage.screenshot({path:`${destination}/warehouse-dialogue.png`});
  await storagePage.locator('#npc-text').getByRole('button', { name: '找回', exact: true }).click();
  await expect(storagePage.locator('#storage-panel')).toContainText('仓库为空');
  await expect(storagePage.locator('#storage-panel')).toHaveCSS('width','308px');
  await expect(storagePage.locator('#storage-panel')).toHaveCSS('height','205px');
  await storagePage.locator('#storage-panel .classic-window-close').click();
  await openWarehouse(storagePage);
  await storagePage.locator('#npc-text').getByRole('button', { name: '保管', exact: true }).click();
  await expect(storagePage.locator('#storage-panel')).toHaveCSS('width','140px');
  await expect(storagePage.locator('#storage-panel')).toHaveCSS('height','181px');
  await expect(storagePage.locator('#inventory-window')).toBeVisible();
  const candle = (await observed(storagePage)).inventory.items.find(item => item.name === '蜡烛');
  assert.ok(candle);
  const alternative=(await observed(storagePage)).inventory.items.find(item=>item.makeIndex!==candle.makeIndex);
  assert.ok(alternative);
  await storagePage.locator(`#inventory-items [data-item-id="${alternative.makeIndex}"]`).dragTo(storagePage.locator('.classic-service-slot'));
  await expect(storagePage.locator('.classic-service-slot')).toHaveAttribute('data-storage-item',String(alternative.makeIndex));
  await storagePage.locator('.classic-service-slot').click();
  await expect(storagePage.locator('#storage-panel').getByRole('button',{name:'存入',exact:true})).toBeDisabled();
  await storagePage.locator(`#inventory-items [data-item-id="${candle.makeIndex}"]`).click();
  await expect(storagePage.locator('.classic-service-slot')).toHaveAttribute('data-storage-item',String(candle.makeIndex));
  await expect.poll(()=>storagePage.locator('.classic-service-slot img').evaluate(image=>image.complete&&image.naturalWidth>0),{timeout:15000}).toBe(true);
  await storagePage.setViewportSize({width:390,height:844});
  await storagePage.screenshot({path:`${destination}/warehouse-deposit-mobile.png`});
  assert.equal(await storagePage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await storagePage.locator('#storage-panel').getByRole('button',{name:'存入',exact:true}).click();
  await expect.poll(async () => (await observed(storagePage)).inventory.items.some(item => item.makeIndex === candle.makeIndex), { timeout: 15000 }).toBe(false);
  await storagePage.setViewportSize({width:1440,height:900});
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
  await taking.locator('#npc-text').getByRole('button', { name: '找回', exact: true }).click();
  const stored=taking.locator(`[data-service-item="${candle.makeIndex}"]`);
  await expect(stored).toContainText('蜡烛');
  await stored.click();
  await expect(stored).toHaveAttribute('aria-pressed','true');
  await taking.screenshot({path:`${destination}/warehouse-selection.png`});
  await taking.locator('#storage-panel').getByRole('button', { name: '取回', exact: true }).click();
  await expect.poll(async () => (await observed(taking)).inventory.items.some(item => item.makeIndex === candle.makeIndex), { timeout: 15000 }).toBe(true);
  assert.equal((await observed(taking)).attributes.gold, 0);
  await taking.screenshot({ path: `${destination}/warehouse-withdrawal.png` });
  await taking.locator('#storage-panel .classic-window-close').click();
  await taking.locator('#close-dialogue').click();
  await taking.keyboard.press('F9');
  await walkToMap(taking,2,11,'0');
  await walkToMap(taking,307,627,'0140');
  assert.ok((await observed(taking)).inventory.items.some(item=>item.makeIndex===candle.makeIndex));
  const mapTransitions=await taking.evaluate(()=>window.__mir2Agent.events().filter(event=>event.type==='gateway-in'&&event.data.type==='map').map(event=>event.data));
  await taking.close();
  assert.deepEqual(warehouseErrors, []);
  assert.deepEqual(warehouseMissing, []);
  report.warehouse = { browserEntrance: true, counterNpcDistance: warehouseNpc.distance, objectLibraries: warehouseMap.objectLibraries, inlineScriptLinks:true, originalPanelDimensions:true, emptyList: true, dragSelectionAndCancel:true, selectedItemImageLoaded:true,mobileDeposit:true, mobileOverflow:false, deposit: true, reconnectWithdrawal: true, sameItemInstance: true, goldPreserved: true, visiblePlayerAfterRoundTrip:true,mapTransitions,errors: warehouseErrors, missingResources: warehouseMissing };
  console.log('PASS source client warehouse: entrance, empty list, deposit and withdrawal after reconnect.');
  report.passed = true;
} catch (error) {
  report.error = error.stack;
  report.failureDiagnostics = activeDiagnostics;
  report.browserConnectedAtFailure = browser.isConnected();
  report.pageClosedAtFailure = activePage?.isClosed();
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: `${destination}/failure.png` }).catch(() => {});
    const state = await observed(activePage).catch(() => undefined);
    report.failureState = state && { map: state.map, worldReady: state.worldReady, attributes: state.attributes, render: state.render, authScene: state.authScene, connection: state.connection };
    report.failureTimeline=await activePage.evaluate(()=>window.__mir2Agent?.events().filter(event=>event.type==='gateway-in'&&['map','entityRemoved','entity','actionResult'].includes(event.data.type)).slice(-80)).catch(()=>undefined);
  }
  process.exitCode = 1;
} finally {
  closingBrowser = true;
  await browser.close();
  await writeFile(`${destination}/evidence.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
