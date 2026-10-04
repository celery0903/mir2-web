import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium, expect } from '@playwright/test';
import { PNG } from 'pngjs';
import PF from 'pathfinding';

assert.equal(process.env.MIR_TEST_FIXTURES, '1', 'Explicit isolated fixture opt-in is required');
const base = (process.env.MIR_URL ?? 'http://127.0.0.1:18883').replace(/\/$/, '');
const project = process.env.MIR_PROJECT ?? 'mir2-rebuild';
const scope = process.env.MIR_SKILL_SCOPE ?? 'fireball';
assert.ok(['fireball', 'shield'].includes(scope));
const fixtureLevel = scope === 'shield' ? 31 : 7, bookName = scope === 'shield' ? '魔法盾' : '火球术', magicId = scope === 'shield' ? 31 : 1;
assert.match(project, /^mir2-(rebuild|skills-test)$/);
assert.equal(new URL(base).hostname, '127.0.0.1');
const destination = process.env.MIR_SKILL_REPORT ?? '.runtime/reports/source-skills';
const execute = promisify(execFile);
const report = { checkedAt: new Date().toISOString(), url: base, project, scope, passed: false, full176Acceptance: false,
  fixture: `New isolated test accounts raised offline to level ${fixtureLevel} with 20000 gold and 400 MP, clamped to native limits on login; skills learned from purchased books.`, errors: [], missingResources: [] };
const bookshopScript = '/data/server/Mir200/Envir/Market_Def/比奇城/小书-0132.txt';
let originalBookshop;
await mkdir(destination, { recursive: true });
await mkdir('.state', { recursive: true });
const suffix = String(Date.now()).slice(-7);
const accounts = [0, 1].map(job => ({ job, account: `q${job}${suffix}`, password: 'Source987', character: `mc${suffix}${job}` }));
await writeFile(`.state/source-skills-${suffix}.json`, JSON.stringify(accounts), { mode: 0o600 });
const browser = await chromium.launch({ headless: true });
const states = page => page.evaluate(() => window.__mir2Agent.snapshot());
const grids = new Map();
async function grid(id) {
  if (!grids.has(id)) {
    const map = await (await fetch(`${base}/maps/${id}/map.json`)).json();
    const cells = Array.from({ length: map.height }, () => Array(map.width).fill(1));
    for (const chunk of map.chunks) {
      const data = new DataView(await (await fetch(`${base}/maps/${id}/${chunk.file}`)).arrayBuffer());
      for (let x = 0; x < chunk.width; x++) for (let y = 0; y < chunk.height; y++) {
        const at = (x * chunk.height + y) * 12;
        cells[chunk.y + y][chunk.x + x] = ((data.getUint16(at, true) | data.getUint16(at + 4, true)) & 0x8000) ? 1 : 0;
      }
    }
    grids.set(id, new PF.Grid(cells));
  }
  return grids.get(id);
}
async function enter(account, register, prepare = () => {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  prepare(page);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) report.missingResources.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  await page.goto(`${base}/?agent=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__mir2Agent, {}, { timeout: 60000 });
  await page.locator('#account').fill(account.account); await page.locator('#password').fill(account.password);
  await page.locator(register ? '#register' : '#auth-login-ok').click();
  await expect(page.locator('[data-auth-select]')).toBeVisible({ timeout: 30000 });
  if (register) {
    await page.locator('[data-auth-new]').click(); await page.locator('#character-name').fill(account.character);
    await page.locator(`[data-auth-job="${account.job}"]`).click(); await page.locator('#auth-create-ok').click();
    await expect(page.locator('[data-auth-select]')).toBeVisible({ timeout: 30000 });
  }
  await page.waitForTimeout(1200); await page.locator('[data-auth-start]').click();
  await expect.poll(async () => { const s = await states(page); return s.worldReady && s.inventory.known && s.render?.framesReady; }, { timeout: 60000 }).toBe(true);
  return page;
}
async function walk(page, x, y, destinationMap) {
  const initial = await states(page), native = await grid(initial.map), changedMap = initial.map !== destinationMap;
  const finder = new PF.AStarFinder({ allowDiagonal: true, dontCrossCorners: false, heuristic: PF.Heuristic.chebyshev });
  for (let attempt = 0; attempt < 40; attempt++) {
    const current = await states(page);
    if (changedMap && current.map === destinationMap || !changedMap && !current.pending && Math.max(Math.abs(current.self.x - x), Math.abs(current.self.y - y)) <= 1) return;
    const available = native.clone();
    for (const actor of current.nearby) if (!actor.dead && (actor.x !== x || actor.y !== y)) available.setWalkableAt(actor.x, actor.y, false);
    const path = finder.findPath(current.self.x, current.self.y, x, y, available).slice(1);
    assert.ok(path.length, `No route to ${destinationMap}/${x},${y}`);
    const [px, py] = path[Math.min(7, path.length - 1)], mini = page.locator('#mini-map'), box = await mini.boundingBox();
    const size = await mini.evaluate(element => ({ width: element.clientWidth, height: element.clientHeight })), map = current.minimap;
    await page.keyboard.down('Shift');
    try { await page.mouse.click(box.x + (map.drawRect.left + px / (map.world.width - 1) * map.drawRect.width) * box.width / size.width, box.y + (map.drawRect.top + py / (map.world.height - 1) * map.drawRect.height) * box.height / size.height); }
    finally { await page.keyboard.up('Shift'); }
    await expect.poll(async () => {
      const s = await states(page); assert.ok(s.self.hp > 0, 'Test character died');
      return s.worldReady && s.render?.framesReady && (s.map === destinationMap && changedMap || s.map === initial.map && !s.pending && !s.intentions.clickDestination);
    }, { timeout: 30000 }).toBe(true);
  }
  assert.fail('Skill preparation route exhausted');
}
let caster, observer;
const casterPackets = [], observerPackets = [], textures = new Set();
function watchSpells(page, packets) {
  page.on('websocket', socket => socket.on('framereceived', frame => {
    const message = JSON.parse(String(frame.payload)).message;
    if (['spellCast', 'magicEffect', 'spellResult', 'health', 'resources', 'characterStatus'].includes(message?.type)) packets.push({ ...message, receivedAt: Date.now() });
  }));
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (response.ok() && /^\/effects\/.+\.png$/.test(path)) textures.add(path);
  });
}
function sampledColors(bytes) {
  const image = PNG.sync.read(bytes), colors = new Set();
  for (let y = 0; y < image.height; y += 7) for (let x = 0; x < image.width; x += 7) {
    const at = (y * image.width + x) * 4;
    colors.add(image.data.subarray(at, at + 3).toString('hex'));
  }
  return colors.size;
}
async function findMonster() {
  const names = ['鸡', '鹿', '稻草人', '多钩猫', '钉耙猫'];
  for (let attempt = 0; attempt < 12; attempt++) {
    const current = await states(caster);
    const candidates = current.nearby.filter(actor => !actor.dead && names.includes(actor.name)).sort((a, b) => a.distance - b.distance);
    const target = candidates.find(actor => actor.distance > 1 && actor.distance <= 7);
    if (target) {
      await walk(observer, current.self.x + 1, current.self.y + 1, '0');
      const updated = (await states(caster)).nearby.find(actor => actor.id === target.id);
      if (updated && !updated.dead && updated.distance > 1 && updated.distance <= 7) return updated;
    } else if (candidates.length) {
      const nearest = candidates[0], map = await grid('0');
      const cells = [];
      for (let dx = -4; dx <= 4; dx++) for (let dy = -4; dy <= 4; dy++) {
        const x = nearest.x + dx, y = nearest.y + dy, distance = Math.max(Math.abs(dx), Math.abs(dy));
        if (distance >= 3 && distance <= 4 && map.isInside(x, y) && map.isWalkableAt(x, y)) cells.push({ x, y });
      }
      cells.sort((a, b) => Math.max(Math.abs(a.x - current.self.x), Math.abs(a.y - current.self.y)) - Math.max(Math.abs(b.x - current.self.x), Math.abs(b.y - current.self.y)));
      assert.ok(cells.length, 'No walkable casting position near the monster');
      await walk(caster, cells[0].x, cells[0].y, '0');
    } else {
      await walk(caster, 278 - attempt % 3 * 4, 613 - Math.floor(attempt / 3) * 3, '0');
    }
  }
  assert.fail('No nearby non-adjacent monster after the actual hunting route');
}
async function verifyShield() {
  await walk(observer, 282, 636, '0132'); await walk(observer, 12, 14, '0132');
  const initial = await states(caster), before = initial.self, mana = initial.attributes.mp;
  const skill = initial.skills.skills.find(skill => skill?.magicId === magicId);
  const round = value => { const low = Math.floor(value); return value - low === 0.5 ? low + low % 2 : Math.round(value); };
  const durationRange = [round((initial.attributes.mc.min + 15) / 4 * (skill.level + 1)) + skill.defPower,
    round((initial.attributes.mc.max + 15) / 4 * (skill.level + 1)) + Math.max(skill.defPower, skill.defMaxPower - 1)];
  await expect.poll(async () => (await states(observer)).nearby.some(actor => actor.id === before.id), { timeout: 15000 }).toBe(true);
  await caster.keyboard.press('F1');
  await expect.poll(() => casterPackets.some(packet => packet.type === 'spellResult' && packet.magicId === magicId && packet.accepted), { timeout: 15000 }).toBe(true);
  for (const page of [caster, observer]) await expect.poll(async () => { const effect = (await states(page)).actorEffects[before.id]; return effect?.active && effect.ready; }, { timeout: 15000 }).toBe(true);
  const activation = casterPackets.find(packet => packet.type === 'characterStatus' && packet.id === before.id && packet.status === 0x00100000);
  assert.ok(activation, 'Shield activation did not come from its native status bit');
  assert.ok(observerPackets.some(packet => packet.type === 'characterStatus' && packet.id === before.id && packet.status === 0x00100000));
  report.shield = { activation, mana: { before: mana, after: (await states(caster)).attributes.mp }, idleFrames: {}, movingAttachment: false, nativeExpiry: false,
    expectedDurationSeconds: durationRange, durationParameters: { maximumSkillLevel: 3, level: skill.level, mc: initial.attributes.mc, defPower: skill.defPower, defMaxPower: skill.defMaxPower },
    durationScope: 'Current native GetPower/MagBubbleDefenceUp parameters, not authenticated 2003 numbers. Long-duration timers are covered by the separate real-assembly regression.' };
  assert.ok(report.shield.mana.after < mana);
  for (const [name, page] of [['caster', caster], ['observer', observer]]) {
    const indices = new Set();
    await expect.poll(async () => { indices.add((await states(page)).actorEffects[before.id].frame); return indices.size; }, { timeout: 5000, intervals: [30] }).toBe(3);
    assert.deepEqual([...indices].sort(), [3890, 3891, 3892]); report.shield.idleFrames[name] = [...indices].sort();
    await page.screenshot({ path: `${destination}/${name}.png` });
  }
  await expect.poll(async () => (await states(caster)).pendingAction, { timeout: 15000 }).toBeFalsy();
  const current = await states(caster), keys = { 0: 'ArrowUp', 2: 'ArrowRight', 4: 'ArrowDown', 6: 'ArrowLeft' };
  const direction = current.directions.find(value => value.clearSteps > 0 && keys[value.direction]); assert.ok(direction);
  await caster.keyboard.press(keys[direction.direction]);
  await expect.poll(async () => { const state = await states(caster); return !state.pending && (state.self.x !== current.self.x || state.self.y !== current.self.y); }, { timeout: 15000 }).toBe(true);
  const moved = await states(caster); assert.equal(moved.render.shield.active, true); assert.deepEqual(moved.render.shield.pixel, moved.render.pixel);
  await expect.poll(async () => { const state = await states(observer), actor = state.nearby.find(actor => actor.id === before.id), effect = state.actorEffects[before.id]; return actor?.x === moved.self.x && actor?.y === moved.self.y && effect?.active && effect.pixel.x === moved.self.x * 48 && effect.pixel.y === moved.self.y * 32; }, { timeout: 15000 }).toBe(true);
  report.shield.movingAttachment = true;
  await expect.poll(async () => (await states(caster)).render.shield.active, { timeout: 70000, intervals: [250] }).toBe(false);
  await expect.poll(async () => (await states(observer)).actorEffects[before.id].active, { timeout: 15000 }).toBe(false);
  const expiry = casterPackets.find(packet => packet.type === 'characterStatus' && packet.id === before.id && packet.status === 0 && packet.receivedAt > activation.receivedAt);
  assert.ok(expiry); report.shield.expiry = expiry; report.shield.elapsedMs = expiry.receivedAt - activation.receivedAt;
  assert.ok(report.shield.elapsedMs >= durationRange[0] * 1000 - 300 && report.shield.elapsedMs <= durationRange[1] * 1000 + 2000, 'Shield expiry does not match the actual native skill parameters');
  assert.ok(!casterPackets.some(packet => packet.type === 'health' && packet.id === before.id && packet.damage > 0 && packet.receivedAt >= activation.receivedAt && packet.receivedAt <= expiry.receivedAt), 'The natural-expiry fixture took unexpected damage');
  report.shield.nativeExpiry = true;
  await expect.poll(async () => (await states(caster)).magicEffects.activeSprites + (await states(observer)).magicEffects.activeSprites, { timeout: 15000 }).toBe(0);
  assert.ok([...textures].some(path => /^\/effects\/Magic\/3890\./.test(path)));
  assert.ok([...textures].some(path => /^\/effects\/Magic\/3900\./.test(path)));
  for (const page of [caster, observer]) await page.setViewportSize({ width: 390, height: 844 });
  await caster.keyboard.press('F1');
  for (const page of [caster, observer]) await expect.poll(async () => (await states(page)).actorEffects[before.id].active, { timeout: 15000 }).toBe(true);
  for (const [name, page] of [['caster', caster], ['observer', observer]]) {
    await page.screenshot({ path: `${destination}/${name}-shield-mobile.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  report.shield.mobileActiveOnBothClients = true;
  await expect.poll(async () => (await states(caster)).render.shield.active, { timeout: 15000 }).toBe(false);
  for (const page of [caster, observer]) await page.setViewportSize({ width: 1440, height: 900 });
}
try {
  for (const account of accounts) { const page = await enter(account, true); assert.equal((await states(page)).attributes.level, 1); await page.close(); }
  await execute('docker', ['stop', `${project}-engine-1`], { timeout: 65000 });
  try {
    if (scope === 'shield') {
      const backup = `${destination}/bookshop-original.txt`;
      await execute('docker', ['cp', `${project}-engine-1:${bookshopScript}`, backup]);
      originalBookshop = backup;
      const original = await readFile(originalBookshop, 'utf8');
      assert.ok(original.includes('[goods]') && !original.split('[goods]')[1].includes('魔法盾'));
      const fixture = `${destination}/shield-bookshop.txt`;
      await writeFile(fixture, `${original}\r\n魔法盾\t1\t10\r\n`);
      await execute('docker', ['cp', fixture, `${project}-engine-1:${bookshopScript}`]);
      report.bookStockFixture = 'One magic-shield book added to the isolated native bookshop for this test, then restored. Production stock is unchanged; obtaining the original Corpse King drop is not verified.';
      report.originalBookshopSha256 = createHash('sha256').update(await readFile(originalBookshop)).digest('hex');
      report.fixtureBookshopSha256 = createHash('sha256').update(await readFile(fixture)).digest('hex');
    }
    for (const account of accounts) {
      assert.match(account.account, /^q[01]\d{7}$/);
      const sql = `UPDATE characters c JOIN characters_ablity a ON a.PlayerId=c.Id SET c.Level=${fixtureLevel},c.Gold=20000,a.Level=${fixtureLevel},a.Hp=${scope === 'shield' ? 400 : 30},a.Mp=400,a.Exp=0 WHERE c.LoginID='${account.account}'`;
      await execute('docker', ['exec', `${project}-db-1`, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --default-character-set=utf8mb4 -uroot mir2_db -e "$1"', 'sh', sql]);
    }
  } finally { await execute('docker', ['start', `${project}-engine-1`]); }
  await expect.poll(async () => (await execute('docker', ['inspect', `${project}-engine-1`, '--format', '{{.State.Health.Status}}'])).stdout.trim(), { timeout: 60000 }).toBe('healthy');
  caster = await enter(accounts[1], false, page => watchSpells(page, casterPackets));
  await walk(caster, 282, 636, '0132'); await walk(caster, 12, 13, '0132');
  await caster.locator('[data-window-open="targets"]').click();
  await caster.locator('#nearby-targets').getByRole('button', { name: /^书店/ }).click();
  await expect(caster.locator('#npc-dialog')).toBeVisible({ timeout: 15000 });
  await caster.locator('#npc-text [data-dialogue-command="@buy"]').click();
  await expect(caster.locator('#shop-panel')).toBeVisible();
  const book = caster.locator('#shop-panel .classic-service-row').filter({ hasText: bookName });
  let shopPages = 1;
  while (!await book.count()) {
    const next = caster.locator('#shop-panel').getByRole('button', { name: '下一页', exact: true });
    assert.ok(shopPages < 10 && await next.isEnabled(), `Purchased skill book ${bookName} is absent from the actual shop stock`);
    await next.click(); shopPages++;
  }
  report.shopPagesVisited = shopPages;
  await book.dblclick();
  await expect.poll(async () => (await states(caster)).inventory.items.some(item => item.name === bookName), { timeout: 15000 }).toBe(true);
  await caster.keyboard.press('Escape'); await caster.keyboard.press('F9');
  if (!await caster.locator('#inventory-window').isVisible()) await caster.keyboard.press('F9');
  await caster.locator('#inventory-items').getByRole('button', { name: bookName, exact: true }).dblclick();
  await expect.poll(async () => (await states(caster)).skills.skills.some(skill => skill?.magicId === magicId), { timeout: 15000 }).toBe(true);
  report.learnedFromPurchasedBook = true;
  await caster.keyboard.press('Escape');
  if (await caster.locator('#inventory-window').isVisible()) await caster.keyboard.press('F9');
  if(scope === 'fireball') { await walk(caster, 14, 16, '0'); await walk(caster, 287, 618, '0'); }
  observer = await enter(accounts[0], false, page => watchSpells(page, observerPackets));
  if(scope === 'shield') await verifyShield();
  else {
  const target = await findMonster();
  const before = (await states(caster)).self, beforeMana = (await states(caster)).attributes.mp;
  await expect.poll(async () => (await states(observer)).nearby.some(actor => actor.id === before.id), { timeout: 15000 }).toBe(true);
  const castStarted = Date.now();
  await caster.keyboard.press('F1'); await caster.locator('[data-window-open="targets"]').click();
  await caster.locator(`#nearby-targets [data-entity-id="${target.id}"]`).click();
  await caster.keyboard.press('Escape');
  await expect.poll(() => observerPackets.some(packet => packet.type === 'spellCast' && packet.casterId === before.id), { timeout: 15000 }).toBe(true);
  for (const page of [caster, observer]) {
    await expect.poll(async () => (await states(page)).magicEffects.activeSprites, { timeout: 15000, intervals: [20] }).toBeGreaterThan(0);
    const effect = (await states(page)).magicEffects.recent.find(effect => effect.casterId === before.id && effect.effect === 1);
    assert.deepEqual(effect, { casterId: before.id, effect: 1, library: 'Magic', start: 0, count: 10, x: before.x, y: before.y });
  }
  const observed = (await states(observer)).nearby.find(actor => actor.id === before.id);
  report.observedSpell = observerPackets.find(packet => packet.type === 'spellCast' && packet.casterId === before.id);
  report.position = { before: { x: before.x, y: before.y }, observer: { x: observed.x, y: observed.y }, caster: (await states(caster)).self };
  await observer.screenshot({ path: `${destination}/observer.png` }); await caster.screenshot({ path: `${destination}/caster.png` });
  assert.deepEqual({ x: observed.x, y: observed.y }, { x: before.x, y: before.y }, 'Observed SM_SPELL target coordinates moved the caster');
  await expect.poll(() => casterPackets.some(packet => packet.type === 'resources' && packet.id === before.id && packet.receivedAt >= castStarted && packet.mp < beforeMana), { timeout: 15000 }).toBe(true);
  await expect.poll(() => casterPackets.some(packet => packet.type === 'spellResult' && packet.magicId === 1 && packet.accepted), { timeout: 15000 }).toBe(true);
  await expect.poll(() => observerPackets.some(packet => packet.type === 'health' && packet.id === target.id && packet.damage > 0), { timeout: 15000 }).toBe(true);
  report.damage = observerPackets.find(packet => packet.type === 'health' && packet.id === target.id && packet.damage > 0);
  const manaPacket = casterPackets.find(packet => packet.type === 'resources' && packet.id === before.id && packet.receivedAt >= castStarted && packet.mp < beforeMana);
  report.mana = { before: beforeMana, after: manaPacket.mp, nativePacket: manaPacket };
  report.readyAnimations = { caster: (await states(caster)).magicEffects, observer: (await states(observer)).magicEffects };
  await expect.poll(async () => (await states(caster)).magicEffects.activeSprites + (await states(observer)).magicEffects.activeSprites, { timeout: 15000 }).toBe(0);
  report.nativeEffects = observerPackets.filter(packet => packet.type === 'magicEffect' && packet.casterId === before.id);
  report.projectiles = { caster: (await states(caster)).magicEffects.flights, observer: (await states(observer)).magicEffects.flights };
  for (const [name, traces] of Object.entries(report.projectiles)) {
    const flight = traces.find(flight => flight.targetId === target.id && flight.effect === 1);
    assert.ok(flight, `${name} did not launch its actual native fireball`);
    assert.equal(flight.phase, 'impact');assert.ok(flight.path.length > 1);
    if (flight.targetMoves === 0) {
      const first = flight.path[0], aim = flight.initialTarget;
      const forward = (first.x - before.x) * (aim.x - before.x) + (first.y - before.y) * (aim.y - before.y);
      assert.ok(forward >= 0, `${name} projectile moved backward before its first frame`);
    }
  }
  await expect.poll(async () => (await states(observer)).actorActions[before.id], { timeout: 15000 }).not.toBe('spell');
  report.observerSpellActionEnded = true;
  }
  report.views = [];
  for (const [name, page] of [['caster', caster], ['observer', observer]]) {
    const desktopColors = sampledColors(await page.locator('#viewport canvas').screenshot());
    assert.ok(desktopColors > 35, `${name} desktop canvas is blank`);
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(500);
    const mobileColors = sampledColors(await page.locator('#viewport canvas').screenshot());
    assert.ok(mobileColors > 35, `${name} mobile canvas is blank`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${destination}/${name}-mobile.png` });
    assert.deepEqual((await states(page)).magicEffects.errors, []);
    report.views.push({ name, desktopColors, mobileColors, mobileOverflow: false });
  }
  report.effectTextures = [...textures];
  assert.ok(textures.size, 'The observer did not load the native cast/effect frames');
  assert.deepEqual(report.errors, []); assert.deepEqual(report.missingResources, []);
  report.passed = true;
} catch (error) {
  report.error = String(error); process.exitCode = 1;
  if (caster) { report.casterState = await states(caster).catch(() => undefined); await caster.screenshot({ path: `${destination}/failure.png` }).catch(() => {}); }
} finally {
  await browser.close();
  if (originalBookshop) {
    try {
      await execute('docker', ['cp', originalBookshop, `${project}-engine-1:${bookshopScript}`]);
      await execute('docker', ['restart', `${project}-engine-1`], { timeout: 65000 });
      await expect.poll(async () => (await execute('docker', ['inspect', `${project}-engine-1`, '--format', '{{.State.Health.Status}}'])).stdout.trim(), { timeout: 60000 }).toBe('healthy');
      const { stdout } = await execute('docker', ['exec', `${project}-engine-1`, 'sha256sum', bookshopScript]);
      assert.equal(stdout.trim().split(/\s+/)[0], report.originalBookshopSha256);
      report.bookStockFixtureRestored = true;
    } catch (error) { report.passed = false; report.restorationError = String(error); process.exitCode = 1; }
  }
  await writeFile(`${destination}/evidence.json`, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
}
