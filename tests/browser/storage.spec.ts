import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { register, Session, directionTo } from '../session.mjs';

test.use({ actionTimeout: 10000, trace: 'off' });

test('native warehouse entrance, empty list, browser deposit and relogin withdrawal preserve the item', async ({ page, baseURL }) => {
  test.setTimeout(180000);
  const suffix = String(Date.now()).slice(-8), account = `s${suffix}`, password = 'Store987';
  await register(account, password);
  const setup = new Session();
  try {
    await setup.login(account, password);
    await setup.create(`仓测${suffix.slice(-5)}`);
    for (let step = 0; step < 100 && setup.map === '0'; step++) {
      const p = setup.user.location, path = await setup.pathTo(307, 627);
      expect(path.length).toBeGreaterThan(0);
      await setup.walk(path.length === 1 ? 4 : directionTo(path[1][0] - p.x, path[1][1] - p.y));
      expect(setup.user.hp).toBeGreaterThan(0);
    }
    expect(setup.map).toBe('0140');
    await setup.logout();
  } finally { await setup.close(); }

  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400 && response.url().includes('/assets/')) errors.push(response.url()); });
  await page.addInitScript(() => {
    const w = window as any, Socket = window.WebSocket;
    w.storageEvidence = { user: null, objects: {}, list: null, results: [] };
    window.WebSocket = class extends Socket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener('message', event => {
          const { type, data } = JSON.parse(event.data), state = w.storageEvidence;
          if (type === 'UserInformation') { state.user = data; state.objects = {}; }
          if (['UserAbility', 'UserLocation', 'UserSlotsRefresh'].includes(type) && state.user) Object.assign(state.user, data);
          if (type === 'ObjectNPC') state.objects[data.objectID] = data;
          if (type === 'NPCStorageList') state.list = data.list;
          if (type === 'StorageResult') state.results.push(data);
        });
      }
    };
  });
  const observed = () => page.evaluate(() => (window as any).storageEvidence);
  const login = async () => {
    const previousUser = (await observed()).user?.objectID;
    await expect(page.locator('#connection-status')).toHaveText('已连接');
    await page.locator('#account').fill(account);
    await page.locator('#password').fill(password);
    await page.waitForTimeout(2000);
    await page.locator('#auth-submit').click();
    await page.locator('.character').click();
    await page.locator('#start-character').click();
    await expect(page.locator('#player-hud')).toBeVisible();
    await expect.poll(async () => (await observed()).user?.objectID).not.toBe(previousUser);
    await expect(page.locator('#world')).toHaveAttribute('data-map-ready', 'true');
    await expect.poll(async () => Object.values((await observed()).objects).some((o: any) => o.name === '边界村保管员')).toBe(true);
    await page.waitForTimeout(800);
  };
  const openWarehouse = async () => {
    const s = await observed(), p = s.user.location;
    const npc = Object.values(s.objects).find((o: any) => o.name === '边界村保管员') as any;
    const rows: string[] = await page.evaluate(async () => (await (await fetch('/assets/classic/maps/0140/collision.json')).json()).rows);
    const scrollX = Math.max(0, Math.min(rows[0].length * 48 - 800, p.x * 48 + 24 - 400));
    const scrollY = Math.max(0, Math.min(rows.length * 32 - 600, p.y * 32 + 78 - 300));
    const box = (await page.locator('#world canvas').boundingBox())!;
    // This opaque torso pixel sits above the NPC's tile in every exported stand frame.
    await page.mouse.click(box.x + (npc.location.x * 48 + 26.5 - scrollX) * box.width / 800, box.y + (npc.location.y * 32 - 14.5 - scrollY) * box.height / 600);
    await expect(page.locator('#npc-panel'), JSON.stringify({ errors })).toBeVisible();
  };
  await page.goto(baseURL!);
  await login();
  expect((await observed()).user.map).toBe('0140');
  const sword = (await observed()).user.inventory.find((item: any) => item?.name === '木剑');
  expect(sword).toBeTruthy();
  await openWarehouse();
  await page.locator('[data-npc-key="[@getback]"]').click();
  await expect(page.locator('#shop-window')).toBeVisible();
  await expect(page.locator('.shop-item')).toHaveCount(0);
  expect((await observed()).list).toEqual([]);
  await page.locator('[data-npc-key="[@Main]"]').click();
  await page.locator('[data-npc-key="[@storage]"]').click();
  await expect(page.locator('#storage-window')).toBeVisible();
  await expect(page.locator('#storage-confirm')).toBeDisabled();
  await page.locator('#inventory').getByRole('button', { name: '木剑', exact: true }).dragTo(page.locator('#storage-slot'));
  await expect(page.locator('#storage-slot img')).toBeVisible();
  await page.screenshot({ path: 'test-results/correction-storage-deposit.png' });
  await page.locator('#storage-confirm').click();
  await expect.poll(async () => (await observed()).user.inventory.some((item: any) => item?.uniqueID === sword.uniqueID)).toBe(false);
  await expect(page.locator('#storage-slot img')).toHaveCount(0);
  await page.locator('[data-npc-key="[@Main]"]').click();
  await page.locator('[data-npc-key="[@getback]"]').click();
  await expect(page.locator('.shop-item')).toHaveCount(1);
  expect((await observed()).list[0]).toMatchObject({ uniqueID: sword.uniqueID, durability: sword.durability, maxDurability: sword.maxDurability });
  await page.screenshot({ path: 'test-results/correction-storage.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '退出游戏', exact: true }).click();
  await expect(page.locator('#auth-submit')).toBeVisible();
  await login();
  await openWarehouse();
  await page.locator('[data-npc-key="[@getback]"]').click();
  await expect(page.locator('.shop-item')).toHaveCount(1);
  expect((await observed()).list[0]).toMatchObject({ uniqueID: sword.uniqueID, durability: sword.durability });
  await page.locator('.shop-item').click();
  await page.getByRole('button', { name: '取回选中物品', exact: true }).click();
  await expect(page.locator('.shop-item')).toHaveCount(0);
  await expect.poll(async () => (await observed()).user.inventory.filter((item: any) => item?.uniqueID === sword.uniqueID).length).toBe(1);
  expect((await observed()).user.inventory.find((item: any) => item?.uniqueID === sword.uniqueID)).toMatchObject({ durability: sword.durability, maxDurability: sword.maxDurability });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '退出游戏', exact: true }).click();
  await expect(page.locator('#auth-submit')).toBeVisible();
  expect(errors).toEqual([]);
  await writeFile('test-results/correction-storage-evidence.json', JSON.stringify({ setup: 'Fresh account and native protocol movement through 0 -> 0140; no database or item injection', controls: 'Browser clicks and drag/drop for all storage operations', emptyList: true, deposited: true, reloginPreservedStorage: true, withdrawnOnce: true, originalItemIDAndDurabilityPreserved: true, originalFrames: [385, 392, 393], errors }, null, 2) + '\n');
});
