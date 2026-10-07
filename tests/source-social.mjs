import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import PF from 'pathfinding';
import { PNG } from 'pngjs';

const base = (process.env.MIR_URL ?? 'http://172.30.0.16:18880').replace(/\/$/, '');
const destination = resolve(process.env.MIR_SOCIAL_REPORT ?? '.runtime/reports/source-social');
const suffix = String(Date.now()).slice(-6);
const resumeAccounts = process.env.MIR_SOCIAL_ACCOUNTS;
const accounts = resumeAccounts ? JSON.parse(await readFile(resumeAccounts, 'utf8')) : Array.from({ length: 3 }, (_, i) => ({
  account: `so${suffix}${i}`, password: randomBytes(5).toString('hex'), character: `so${suffix}${i}`
}));
assert.equal(accounts.length, 3);
assert.equal(new Set(accounts.map(account => account.account)).size, 3);
for (const account of accounts) { assert.match(account.account, /^so\d{7}$/); assert.equal(account.character, account.account); }
await mkdir(destination, { recursive: true });
await mkdir('.state', { recursive: true });
await writeFile(`.state/source-social-${suffix}.json`, JSON.stringify(accounts), { mode: 0o600 });
const report = { checkedAt: new Date().toISOString(), url: base, passed: false, full176Acceptance: false,
  scope: 'Three ordinary level-one browser characters; native group permissions, membership and chat. No offline data fixtures.',
  reusedBrowserCharacters: Boolean(resumeAccounts), checks: {}, walks: [], errors: [], missingResources: [], entries: [], browserEvents: [] };
const browser = await chromium.launch({ headless: true });
let closingBrowser = false;
browser.on('disconnected', () => {
  if (!closingBrowser) report.browserEvents.push({ type: 'disconnected', at: new Date().toISOString(), phase: report.phase });
});
const pages = [], packets = [[], [], []], grids = new Map();
const snapshot = page => page.evaluate(() => window.__mir2Agent.snapshot());
const members = page => page.locator('#group-members li').allTextContents();

async function enter(account, index, register = false) {
  const entry = { index, register, stage: 'bootstrap', startedAt: new Date().toISOString(), receivedTypes: [], crashes: [] };
  report.entries.push(entry);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  pages[index] = page;
  page.on('crash', () => entry.crashes.push(new Date().toISOString()));
  page.on('pageerror', error => report.errors.push({ index, message: error.message }));
  page.on('response', response => { if (response.status() >= 400) report.missingResources.push({ index, path: new URL(response.url()).pathname, status: response.status() }); });
  page.on('websocket', socket => socket.on('framereceived', frame => {
    const message = JSON.parse(String(frame.payload)).message;
    if (message) entry.receivedTypes.push(message.type);
    if (message && (/^group|^trade/.test(message.type) || message.type === 'chat')) packets[index].push(message);
  }));
  await page.goto(`${base}/?agent=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__mir2Agent, {}, { timeout: 60000 });
  entry.stage = register ? 'registration' : 'login';
  await page.locator('#account').fill(account.account);
  await page.locator('#password').fill(account.password);
  await page.locator(register ? '#register' : '#auth-login-ok').click();
  await expect(page.locator('[data-auth-select]')).toBeVisible({ timeout: 30000 });
  entry.stage = 'character-selection';
  if (register) {
    await page.locator('[data-auth-new]').click();
    await page.locator('#character-name').fill(account.character);
    await page.locator('[data-auth-job="0"]').click();
    await page.locator('#auth-create-ok').click();
    await expect(page.locator('[data-auth-select]')).toBeVisible({ timeout: 30000 });
  }
  await page.waitForTimeout(1200);
  entry.stage = 'world-entry';
  await page.locator('[data-auth-start]').click();
  await expect.poll(async () => {
    const state = await snapshot(page);
    return state.worldReady && state.inventory.known && state.render?.framesReady && (state.map !== '0' || state.minimap.imageReady);
  }, { timeout: 60000 }).toBe(true);
  const state = await snapshot(page);
  assert.equal(state.attributes.level, 1);
  assert.equal(state.attributes.gold, 0);
  entry.stage = 'ready';
  entry.actorId = state.self.id;
  if (register) {
    await page.keyboard.press('F9');
    for (const name of ['木剑', '布衣(男)']) {
      await page.locator('#inventory-items').getByRole('button', { name, exact: true }).dblclick();
      await expect.poll(async () => (await snapshot(page)).equipment.slots.some(slot => slot.item.name === name), { timeout: 15000 }).toBe(true);
    }
    await page.keyboard.press('F9');
  }
  return page;
}

async function grid(id) {
  if (!grids.has(id)) {
    const response = await fetch(`${base}/maps/${id}/map.json`);
    assert.equal(response.status, 200);
    const map = await response.json(), cells = Array.from({ length: map.height }, () => Array(map.width).fill(1));
    for (const chunk of map.chunks) {
      const response = await fetch(`${base}/maps/${id}/${chunk.file}`);
      assert.equal(response.status, 200);
      const data = new DataView(await response.arrayBuffer());
      for (let x = 0; x < chunk.width; x++) for (let y = 0; y < chunk.height; y++) {
        const at = (x * chunk.height + y) * 12;
        cells[chunk.y + y][chunk.x + x] = ((data.getUint16(at, true) | data.getUint16(at + 4, true)) & 0x8000) ? 1 : 0;
      }
    }
    grids.set(id, new PF.Grid(cells));
  }
  return grids.get(id);
}

async function walk(page, x, y, targetMap) {
  const initial = await snapshot(page), native = await grid(initial.map), changing = initial.map !== targetMap;
  const finder = new PF.AStarFinder({ allowDiagonal: true, dontCrossCorners: false, heuristic: PF.Heuristic.chebyshev });
  let waypoints = 0;
  for (; waypoints < 80; waypoints++) {
    const current = await snapshot(page);
    assert.ok(current.self.hp > 0 && !current.self.dead, 'Social test character died on the actual route');
    if (current.worldReady && current.render?.framesReady && current.map === targetMap &&
      (changing || !current.pending && current.self.x === x && current.self.y === y)) break;
    assert.equal(current.map, initial.map);
    const available = native.clone();
    for (const actor of current.nearby) if (!actor.dead && available.isInside(actor.x, actor.y) && (actor.x !== x || actor.y !== y))
      available.setWalkableAt(actor.x, actor.y, false);
    const path = finder.findPath(current.self.x, current.self.y, x, y, available).slice(1);
    assert.ok(path.length, `No UI route to ${targetMap}/${x},${y}`);
    const [px, py] = path[Math.min(5, path.length - 1)], map = current.minimap, mini = page.locator('#mini-map');
    const box = await mini.boundingBox(), size = await mini.evaluate(element => ({ width: element.clientWidth, height: element.clientHeight }));
    await page.keyboard.down('Shift');
    try {
      await page.mouse.click(box.x + (map.drawRect.left + px / (map.world.width - 1) * map.drawRect.width) * box.width / size.width,
        box.y + (map.drawRect.top + py / (map.world.height - 1) * map.drawRect.height) * box.height / size.height);
    } finally { await page.keyboard.up('Shift'); }
    await expect.poll(async () => {
      const state = await snapshot(page);
      assert.ok(state.self.hp > 0, 'Social test character died');
      return state.worldReady && state.render?.framesReady && (changing && state.map === targetMap || !state.pending && !state.intentions.clickDestination);
    }, { timeout: 30000 }).toBe(true);
  }
  assert.ok(waypoints < 80, 'Social UI route exhausted');
  report.walks.push({ from: { map: initial.map, x: initial.self.x, y: initial.self.y }, targetMap, x, y, waypoints, uiMovementOnly: true });
}

async function openWindow(page, id) {
  if (!await page.locator('#classic-window').isVisible()) await page.locator('[data-window-open="targets"]').click();
  await page.locator(`[data-window-tab="${id}"]`).click();
}
async function openGroup(page) {
  await openWindow(page, 'group');
  await expect(page.locator('#group-panel')).toBeVisible();
}
async function command(page, index, button, target, accepted, reason) {
  const cursor = packets[index].length;
  await page.locator('#group-target').fill(target);
  await page.locator(button).click();
  await expect.poll(() => packets[index].slice(cursor).find(message => message.type === 'groupResult'), { timeout: 15000 }).toBeTruthy();
  const result = packets[index].slice(cursor).find(message => message.type === 'groupResult');
  assert.equal(result.accepted, accepted, JSON.stringify(result));
  if (reason !== undefined) assert.equal(result.reason, reason);
}
async function mode(page, enabled) {
  const expected = `允许组队：${enabled ? '开' : '关'}`;
  if (await page.locator('#group-mode').textContent() !== expected) await page.locator('#group-mode').click();
  await expect(page.locator('#group-mode')).toHaveText(expected, { timeout: 15000 });
}
async function rendered(page, name) {
  const bytes = await page.screenshot({ path: join(destination, name + '.png') });
  const png = PNG.sync.read(bytes), colors = new Set();
  for (let y = 0; y < png.height; y += 7) for (let x = 0; x < png.width; x += 7) {
    const at = (y * png.width + x) * 4;
    colors.add(png.data.subarray(at, at + 3).toString('hex'));
  }
  assert.ok(colors.size > 100, 'Blank social view');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  return colors.size;
}

try {
  report.phase = 'registration-and-native-shop-route';
  for (const [index, account] of accounts.entries()) {
    const page = await enter(account, index, !resumeAccounts);
    if ((await snapshot(page)).map === '0') await walk(page, 282, 636, '0132');
    assert.equal((await snapshot(page)).map, '0132');
    await walk(page, 11 + index, 15, '0132');
    console.log(`Character ${index + 1}/3 reached the native bookshop through the UI.`);
  }
  report.checks.ordinaryCharactersAndRoutes = true;
  const [leader, member, third] = pages;
  for (const page of pages) await openGroup(page);
  report.phase = 'permission-rejection';
  await mode(leader, false);
  await mode(member, false);
  await command(leader, 0, '#group-create', accounts[1].character, false, -4);
  assert.deepEqual(await members(leader), []);
  report.checks.closedInvitationRejected = true;
  await mode(member, true);
  report.phase = 'creation-permission';
  await command(leader, 0, '#group-create', accounts[1].character, true);
  const pair = accounts.slice(0, 2).map(account => account.character);
  for (const page of [leader, member]) await expect.poll(() => members(page), { timeout: 15000 }).toEqual(pair);
  await expect(leader.locator('#group-mode')).toHaveText('允许组队：开');
  report.checks.nativeCreationEnablesLeaderPermission = true;
  report.phase = 'member-permission-and-removal';
  await mode(third, true);
  await command(member, 1, '#group-add', accounts[2].character, false, -1);
  await command(leader, 0, '#group-add', accounts[2].character, true);
  const all = accounts.map(account => account.character);
  for (const page of pages) await expect.poll(() => members(page), { timeout: 15000 }).toEqual(all);
  report.checks.leaderOnlyInvitation = true;
  report.groupDesktopColors = await rendered(leader, 'group-desktop');
  await third.setViewportSize({ width: 390, height: 844 });
  report.groupMobileColors = await rendered(third, 'group-mobile');
  await command(leader, 0, '#group-remove', accounts[2].character, true);
  await expect.poll(() => members(third), { timeout: 15000 }).toEqual([]);
  await expect(third.locator('#group-mode')).toHaveText('允许组队：开');
  for (const page of [leader, member]) await expect.poll(() => members(page), { timeout: 15000 }).toEqual(pair);
  report.checks.removalPreservesNativePermission = true;
  await third.setViewportSize({ width: 1440, height: 900 });
  await command(leader, 0, '#group-add', accounts[2].character, true);
  report.checks.reinviteWithoutPermissionToggle = true;
  report.phase = 'native-group-chat';
  await openWindow(leader, 'chat');
  const text = `组队核对${suffix}`;
  await leader.locator('#chat-channel').selectOption('group');
  await leader.locator('#chat-input').fill(text);
  await leader.locator('#chat-form').getByRole('button', { name: '发送', exact: true }).click();
  for (const page of pages) await expect(page.locator('#chat-log')).toContainText(text, { timeout: 15000 });
  report.checks.chatDeliveredToAllMembers = true;
  report.phase = 'disband-and-permission';
  await openGroup(leader);
  await command(leader, 0, '#group-remove', accounts[0].character, true);
  for (const page of pages) {
    await expect.poll(() => members(page), { timeout: 15000 }).toEqual([]);
    await expect(page.locator('#group-mode')).toHaveText('允许组队：开');
  }
  report.checks.disbandPreservesAllPermissions = true;
  console.log('Invitation, membership, native chat and disband checks passed. Checking reconnect.');
  await command(leader, 0, '#group-create', accounts[2].character, true);
  report.phase = 'disconnect-cleanup-and-reconnect';
  await third.close();
  await expect.poll(() => members(leader), { timeout: 30000 }).toEqual([]);
  await expect(leader.locator('#group-mode')).toHaveText('允许组队：开');
  const reconnected = await enter(accounts[2], 2);
  await openGroup(reconnected);
  await expect(reconnected.locator('#group-mode')).toHaveText('允许组队：开');
  assert.deepEqual(await members(reconnected), []);
  await command(leader, 0, '#group-create', accounts[2].character, true);
  report.checks.disconnectCleanupAndSavedPermission = true;
  await command(leader, 0, '#group-remove', accounts[0].character, true);
  await mode(reconnected, false);
  await reconnected.close();
  const disabled = await enter(accounts[2], 2);
  await openGroup(disabled);
  await expect(disabled.locator('#group-mode')).toHaveText('允许组队：关');
  await command(leader, 0, '#group-create', accounts[2].character, false, -4);
  report.checks.reconnectPreservesDisabledPermission = true;
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.missingResources, []);
  assert.deepEqual(report.browserEvents, []);
  report.passed = true;
  report.phase = 'complete';
  console.log('Native browser group workflow passed. ' + destination);
} catch (error) {
  report.error = String(error);
  for (const [index, page] of pages.entries()) if (page && !page.isClosed()) {
    try {
      report[`state${index}`] = await snapshot(page);
      await page.screenshot({ path: join(destination, `failure-${index}.png`) });
    } catch (diagnosticError) {
      (report.diagnosticErrors ??= []).push({ index, message: String(diagnosticError) });
    }
  }
  process.exitCode = 1;
  console.error(report.phase + ': ' + report.error);
} finally {
  report.packets = packets;
  closingBrowser = true;
  await browser.close();
  await writeFile(join(destination, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
}
