import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test.use({ actionTimeout: 10000, trace: 'off' });

test('original account screens, acknowledged two-tile run and opaque HUD clicks', async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.classicEvidence = { user: null, objects: {}, commands: [] };
    const Socket = window.WebSocket;
    window.WebSocket = class extends Socket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener('message', event => {
          const { type, data } = JSON.parse(event.data), s = w.classicEvidence;
          if (type === 'UserInformation') s.user = data;
          if (type === 'UserLocation' && s.user) Object.assign(s.user, data);
          if (['ObjectPlayer', 'ObjectMonster', 'ObjectNPC'].includes(type)) s.objects[data.objectID] = data;
          if (['ObjectWalk', 'ObjectRun'].includes(type) && s.objects[data.objectID]) Object.assign(s.objects[data.objectID], data);
          if (['ObjectRemove', 'ObjectDied'].includes(type)) delete s.objects[data.objectID];
        });
      }
      send(data: string) {
        const packet = JSON.parse(data);
        if (['Walk', 'Run', 'Attack'].includes(packet.type)) w.classicEvidence.commands.push(packet);
        super.send(data);
      }
    };
  });
  const observed = () => page.evaluate(() => (window as any).classicEvidence);
  const suffix = Date.now().toString().slice(-8), account = `c${suffix}`, password = 'Classic987';
  await page.goto(baseURL!);
  await expect(page.locator('#connection-status')).toHaveText('已连接');
  await expect(page.locator('#modal')).toHaveClass(/login-window/);
  await page.screenshot({ path: 'test-results/correction-login.png' });
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await expect(page.locator('#modal')).toHaveClass(/register-window/);
  await page.getByRole('button', { name: '返回登录', exact: true }).click();
  await expect(page.locator('#modal')).toHaveClass(/login-window/);
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.locator('#account').fill(account);
  await page.locator('#password').fill(password);
  await page.locator('#confirm-password').fill('Wrong987');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#form-error')).toHaveText('两次密码不一致');
  await page.locator('#confirm-password').fill(password);
  await page.screenshot({ path: 'test-results/correction-register.png' });
  await page.locator('#auth-submit').click();
  await expect(page.locator('#modal')).toHaveClass(/select-window/);
  await page.screenshot({ path: 'test-results/correction-selection.png' });
  await page.getByRole('button', { name: '创建角色', exact: true }).click();
  await page.locator('#character-name').fill(`古战${suffix.slice(-5)}`);
  await page.getByRole('button', { name: '女', exact: true }).click();
  await expect(page.getByRole('button', { name: '女', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: 'test-results/correction-creation.png' });
  await page.getByRole('button', { name: '创建并进入', exact: true }).click();
  await expect(page.locator('#world')).toHaveAttribute('data-map-ready', 'true');
  await expect(page.locator('.blood-orb')).toHaveClass(/red-only/);
  await page.locator('#native-bag-toggle').click();
  await page.locator('#inventory').getByRole('button', { name: '布衣(女)', exact: true }).dblclick();
  await page.locator('#close-bag').click();
  await page.keyboard.press('F10');
  await expect(page.locator('#equipment').getByRole('button', { name: '布衣(女)', exact: true })).toBeVisible();
  await page.locator('#close-character').click();
  await page.waitForTimeout(750);

  const rows: string[] = await page.evaluate(async () => (await (await fetch('/assets/classic/collision.json')).json()).rows);
  const canvas = page.locator('#world canvas'), box = (await canvas.boundingBox())!;
  let ran = false;
  for (const [direction, dx, dy] of [[6, -1, 0], [0, 0, -1], [2, 1, 0], [4, 0, 1]]) {
    const s = await observed(), p = s.user.location;
    const clear = (x: number, y: number) => rows[y]?.[x] === '0' && !Object.values(s.objects).some((o: any) => o.location.x === x && o.location.y === y);
    if (!clear(p.x + dx, p.y + dy) || !clear(p.x + dx * 2, p.y + dy * 2)) continue;
    const target = { x: p.x + dx * 2, y: p.y + dy * 2 };
    const scrollX = Math.max(0, Math.min(rows[0].length * 48 - 800, p.x * 48 + 24 - 400));
    const scrollY = Math.max(0, Math.min(rows.length * 32 - 600, p.y * 32 + 78 - 300));
    const after = s.commands.length;
    await page.mouse.click(box.x + (target.x * 48 + 24 - scrollX) * box.width / 800, box.y + (target.y * 32 + 16 - scrollY) * box.height / 600, { button: 'right' });
    try {
      await expect.poll(async () => (await observed()).user.location, { timeout: 2500 }).toEqual(target);
      expect((await observed()).commands.slice(after)).toContainEqual({ type: 'Run', data: { direction } });
      ran = true; break;
    } catch { /* A moving actor can enter the route before the server receives the request. */ }
  }
  expect(ran, 'At least one clear cardinal route must produce a server-acknowledged two-tile run').toBe(true);
  await page.waitForTimeout(750);
  const hit = await page.evaluate(async collision => {
    const ui = await (await fetch('/assets/classic/ui.json')).json();
    const rect = document.querySelector('#world canvas')!.getBoundingClientRect();
    const state = (window as any).classicEvidence, p = state.user.location;
    const scrollX = Math.max(0, Math.min(collision[0].length * 48 - 800, p.x * 48 + 24 - 400));
    const scrollY = Math.max(0, Math.min(collision.length * 32 - 600, p.y * 32 + 78 - 300));
    const candidates = new Map<string, any>();
    for (let y = 350; y < 440; y++) for (let x = 150; x < 620; x++) {
      const tx = Math.floor((x + scrollX) / 48), ty = Math.floor((y + scrollY) / 32);
      if (collision[ty]?.[tx] !== '0' || Object.values(state.objects).some((o: any) => o.location.x === tx && o.location.y === ty)) continue;
      const px = rect.x + (x + 0.5) * rect.width / 800, py = rect.y + (y + 0.5) * rect.height / 600;
      if (document.elementFromPoint(px, py)?.tagName !== 'CANVAS') continue;
      const key = `${tx},${ty}`, candidate = candidates.get(key) ?? { location: { x: tx, y: ty } };
      candidate[ui.hudHitRows[y - 349]?.[x] === '1' ? 'opaque' : 'transparent'] = { x: px, y: py, logicalX: x, logicalY: y };
      candidates.set(key, candidate);
      if (candidate.opaque && candidate.transparent) return candidate;
    }
    throw new Error('No reachable tile has both opaque and transparent HUD pixels over the canvas');
  }, rows);
  const beforeHUD = await observed();
  await page.mouse.click(hit.opaque.x, hit.opaque.y, { button: 'right' });
  await page.waitForTimeout(1000);
  const afterHUD = await observed();
  expect(afterHUD.commands.slice(beforeHUD.commands.length), JSON.stringify({ hit, before: beforeHUD.user.location, after: afterHUD.user.location })).toEqual([]);
  expect((await observed()).user.location).toEqual(beforeHUD.user.location);
  await page.mouse.click(hit.transparent.x, hit.transparent.y, { button: 'right' });
  await expect.poll(async () => (await observed()).user.location, { timeout: 8000 }).toEqual(hit.location);
  await page.getByRole('button', { name: '退出游戏', exact: true }).click();
  await expect(page.locator('#auth-submit')).toBeVisible();
  await expect(page.locator('#connection-status')).toHaveText('已连接');
  await page.locator('#account').fill(account);
  await page.locator('#password').fill(password);
  await page.waitForTimeout(2000);
  await page.locator('#auth-submit').click();
  await expect(page.locator('.character')).toHaveCount(1);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '删除人物', exact: true }).click();
  await expect(page.locator('.character')).toHaveCount(0);
  await writeFile('test-results/correction-layout-evidence.json', JSON.stringify({ originalAccountFrames: [60, 63, 65, 73], femaleStarterEquipment: true, lowLevelWarriorRedOrb: true, rightClickRun: { distance: 2, serverAcknowledged: true }, opaqueHUDClickBlocked: true, transparentHUDClickReachesSameMapTile: true, ownedTestCharacterDeletion: true }, null, 2) + '\n');
});
