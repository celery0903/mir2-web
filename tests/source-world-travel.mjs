import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium, expect } from '@playwright/test';
import { PNG } from 'pngjs';

assert.equal(process.env.MIR_TEST_FIXTURES, '1', 'Isolated position fixtures require explicit opt-in');
const base = (process.env.MIR_URL ?? 'http://127.0.0.1:18883').replace(/\/$/, '');
const project = process.env.MIR_PROJECT ?? 'mir2-rebuild';
assert.equal(new URL(base).hostname, '127.0.0.1');
assert.equal(project, 'mir2-rebuild');
const destination = process.env.MIR_WORLD_TRAVEL_REPORT ?? '.runtime/reports/source-world-travel';
const execute = promisify(execFile);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const inspect = async service => JSON.parse((await execute('docker', ['inspect', `${project}-${service}-1`])).stdout)[0];
const engine = await inspect('engine');
assert.equal(engine.Config.Labels['com.docker.compose.project'], project);
assert.ok(engine.Config.Env.includes('MIR_WORLD_CANDIDATE=1'), 'Requires the isolated full world review image');
const expectedImage = (await execute('docker', ['image', 'inspect', process.env.MIR_WORLD_PROFILE_IMAGE ?? 'mir2-world-review-engine:test', '--format', '{{.Id}}'])).stdout.trim();
assert.equal(engine.Image, expectedImage);
const audit = JSON.parse((await execute('docker', ['exec', `${project}-engine-1`, 'node', '-e', 'process.stdout.write(require("fs").readFileSync("/profile/audit.json"))'])).stdout);
assert.equal(audit.maps.length, 256);
const report = { checkedAt: new Date().toISOString(), url: base, project, passed: false, full176Acceptance: false,
  fixture: 'New level-one, zero-gold accounts moved offline to original route approaches. No stats, skills, items, NPC scripts or route coordinates changed. This does not verify travelling from birth to these regions.',
  images: { engine: engine.Image, web: (await inspect('web')).Image, proxy: (await inspect('source-proxy')).Image },
  errors: [], missingResources: [], routes: [], candidateServiceAcceptance: audit.candidateServiceAcceptance };
await mkdir(destination, { recursive: true });
await mkdir('.state', { recursive: true });
const suffix = String(Date.now()).slice(-7);
const fixtures = [
  { flow: 'border', map: '0', x: 324, y: 36 },
  { flow: 'npc', map: '1', x: 52, y: 33 },
  { flow: 'alias', map: '11', x: 204, y: 387 }
].map((fixture, index) => ({ ...fixture, account: `w${index}${suffix}`, password: 'Source987', character: `wr${suffix}${index}` }));
await writeFile(`.state/source-world-travel-${suffix}.json`, JSON.stringify(fixtures), { mode: 0o600 });
const browser = await chromium.launch({ headless: true });
let activePage;
const packets = new Map();
const state = page => page.evaluate(() => window.__mir2Agent.snapshot());
async function enter(fixture, register = false) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  activePage = page;
  const received = [];
  packets.set(page, received);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400) report.missingResources.push({ path: new URL(response.url()).pathname, status: response.status() });
  });
  page.on('websocket', socket => socket.on('framereceived', frame => {
    const message = JSON.parse(String(frame.payload)).message;
    if (['map', 'actionResult', 'npcDialogue'].includes(message?.type)) received.push(message);
  }));
  await page.goto(`${base}/?agent=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__mir2Agent, {}, { timeout: 60000 });
  await page.locator('#account').fill(fixture.account);
  await page.locator('#password').fill(fixture.password);
  await page.locator(register ? '#register' : '#auth-login-ok').click();
  await expect(page.locator('[data-auth-select]')).toBeVisible({ timeout: 30000 });
  if (register) {
    await page.locator('[data-auth-new]').click();
    await page.locator('#character-name').fill(fixture.character);
    await page.locator('[data-auth-job="0"]').click();
    await page.locator('#auth-create-ok').click();
    await expect(page.locator('[data-auth-select]')).toBeVisible({ timeout: 30000 });
  }
  await page.waitForTimeout(1200);
  await page.locator('[data-auth-start]').click();
  await expect.poll(async () => { const s = await state(page); return s.worldReady && s.inventory.known && s.render?.framesReady; }, { timeout: 60000 }).toBe(true);
  const initial = await state(page);
  assert.equal(initial.attributes.level, 1);
  assert.equal(initial.attributes.gold, 0);
  assert.ok(initial.self.hp > 0);
  return page;
}
async function readyAt(page, map, x, y) {
  await expect.poll(async () => {
    const s = await state(page);
    assert.ok(s.self.hp > 0, 'The route test character died');
    return s.worldReady && s.render?.framesReady && !s.pending && s.map === map && s.self.x === x && s.self.y === y;
  }, { timeout: 20000 }).toBe(true);
}
async function step(page, key, map, x, y) {
  await expect.poll(async () => !(await state(page)).pendingAction, { timeout: 10000 }).toBe(true);
  await page.keyboard.press(key);
  await readyAt(page, map, x, y);
}
async function screenshot(page, name) {
  await page.waitForTimeout(600);
  const bytes = await page.locator('#viewport canvas').screenshot();
  const png = PNG.sync.read(bytes), colors = new Set();
  for (let y = 0; y < png.height; y += 7) for (let x = 0; x < png.width; x += 7) {
    const at = (y * png.width + x) * 4;
    colors.add(png.data.subarray(at, at + 3).toString('hex'));
  }
  assert.ok(colors.size > 35, `Blank route canvas: ${name}`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${destination}/${name}.png` });
  return { sampledColors: colors.size, width: png.width, height: png.height };
}
async function sql(query) {
  return (await execute('docker', ['exec', `${project}-db-1`, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --default-character-set=utf8mb4 -uroot mir2_db --batch --skip-column-names -e "$1"', 'sh', query])).stdout.trim();
}
async function saved(fixture, map, x, y) {
  await expect.poll(async () => {
    const result = await sql(`SELECT MapName,CX,CY,Level,Gold FROM characters WHERE LoginID='${fixture.account}' AND ChrName='${fixture.character}'`);
    return result;
  }, { timeout: 20000 }).toBe(`${map}\t${x}\t${y}\t1\t0`);
}
try {
  for (const fixture of fixtures) {
    const page = await enter(fixture, true);
    fixture.original = { map: (await state(page)).map, self: (await state(page)).self };
    await page.close();
  }
  const stoppedAt = new Date().toISOString();
  await execute('docker', ['stop', `${project}-engine-1`], { timeout: 65000 });
  const shutdown = (await execute('docker', ['logs', '--since', stoppedAt, `${project}-engine-1`])).stdout;
  report.fixtureShutdown = { nativeSaveAcknowledged: shutdown.includes('OPENMIR2_SAVE_COMPLETE'), nativeExit: shutdown.includes('OPENMIR2_GAME_EXIT=0') };
  try {
    assert.ok(report.fixtureShutdown.nativeSaveAcknowledged && report.fixtureShutdown.nativeExit);
    for (const fixture of fixtures) {
      assert.match(fixture.account, /^w[012]\d{7}$/);
      const count = await sql(`UPDATE characters SET MapName='${fixture.map}',CX=${fixture.x},CY=${fixture.y} WHERE LoginID='${fixture.account}' AND ChrName='${fixture.character}' AND Level=1 AND Gold=0; SELECT ROW_COUNT();`);
      assert.equal(count, '1');
    }
  } finally { await execute('docker', ['start', `${project}-engine-1`]); }
  await expect.poll(async () => (await inspect('engine')).State.Health.Status, { timeout: 90000 }).toBe('healthy');

  const border = await enter(fixtures[0]);
  await readyAt(border, '0', 324, 36);
  await step(border, 'ArrowUp', '0', 324, 35);
  await step(border, 'ArrowUp', '1', 559, 553);
  const borderScreen = await screenshot(border, 'bichon-to-woma-desktop');
  await border.setViewportSize({ width: 390, height: 844 });
  const borderMobile = await screenshot(border, 'woma-mobile');
  await step(border, 'ArrowDown', '0', 324, 35);
  assert.ok(packets.get(border).some(packet => packet.type === 'map' && packet.map === '1'));
  report.routes.push({ flow: 'border', passed: true, approach: { map: '0', x: 324, y: 36 }, outward: { map: '1', x: 559, y: 553 }, return: { map: '0', x: 324, y: 35 }, screenshots: [borderScreen, borderMobile], packets: packets.get(border) });
  await border.close();
  await saved(fixtures[0], '0', 324, 35);

  const npc = await enter(fixtures[1]);
  await readyAt(npc, '1', 52, 33);
  await npc.locator('[data-window-open="targets"]').click();
  await npc.locator('#nearby-targets').getByRole('button', { name: /^传送员/ }).click();
  await expect(npc.locator('#npc-dialog')).toBeVisible({ timeout: 15000 });
  await expect(npc.locator('#npc-text')).toContainText('白日门');
  await npc.locator('#npc-text [data-dialogue-command="@br"]').click();
  await readyAt(npc, '11', 47, 477);
  assert.ok(packets.get(npc).some(packet => packet.type === 'map' && packet.map === '11'));
  const npcScript = await readFile('.runtime/classic-world/profile/Envir/Market_Def/传送员/进白日门-1.txt');
  report.routes.push({ flow: 'npc', passed: true, sourceScriptSha256: digest(npcScript), nativeTarget: { map: '11', x: 47, y: 477 }, screenshot: await screenshot(npc, 'white-gate-npc-desktop'), packets: packets.get(npc) });
  await npc.close();
  await saved(fixtures[1], '11', 47, 477);

  const alias = await enter(fixtures[2]);
  await readyAt(alias, '11', 204, 387);
  await step(alias, 'ArrowUp', '11', 204, 386);
  await step(alias, 'ArrowUp', '0123', 12, 18);
  assert.ok(packets.get(alias).some(packet => packet.type === 'map' && packet.map === '0123'));
  const aliasScreen = await screenshot(alias, 'alias-room-desktop');
  await alias.close();
  await saved(fixtures[2], '0123A', 12, 18);
  const returning = await enter(fixtures[2]);
  await readyAt(returning, '0123', 12, 18);
  await step(returning, 'ArrowUp', '0123', 12, 17);
  await step(returning, 'ArrowDown', '11', 205, 386);
  report.routes.push({ flow: 'alias', passed: true, logicalMapSaved: '0123A', graphicMapReceived: '0123', reconnect: true, return: { map: '11', x: 205, y: 386 }, screenshot: aliasScreen, packets: [...packets.get(alias), ...packets.get(returning)] });
  await returning.close();
  await saved(fixtures[2], '11', 205, 386);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.missingResources, []);
  report.passed = true;
} catch (error) {
  report.error = String(error);
  if (activePage && !activePage.isClosed()) {
    report.failedState = await state(activePage).catch(() => null);
    report.failedPackets = packets.get(activePage);
    await activePage.screenshot({ path: `${destination}/failure.png` }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(`${destination}/evidence.json`, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ passed: report.passed, routes: report.routes.map(route => ({ flow: route.flow, passed: route.passed })), error: report.error, full176Acceptance: false }, null, 2));
