import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';
test.use({ actionTimeout: 10000, trace: 'off' });

test('desktop and mobile play against the Docker server', async ({ browser, baseURL }) => {
  const errors: string[] = [];
  const missing: string[] = [];
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400 && response.url().includes('/assets/')) missing.push(`${response.status()} ${response.url()}`); });
  await page.goto(baseURL!);
  await expect(page.locator('#connection-status')).toHaveText('已连接');
  await expect(page.locator('#world canvas')).toBeVisible();
  await expect(page.locator('#auth-submit')).toBeEnabled();
  await page.getByRole('button', { name: '注册', exact: true }).click();
  const suffix = Date.now().toString().slice(-9);
  const account = `u${suffix}`, password = 'UiTest987';
  await page.locator('#account').fill(account);
  await page.locator('#password').fill(password);
  await page.locator('#confirm-password').fill(password);
  await page.locator('#userName').fill('界面测试');
  await page.locator('#birthDay').fill('2000/01/01');
  await page.locator('#auth-submit').click();
  await expect(page.getByRole('heading', { name: '选择角色' })).toBeVisible();
  await page.getByRole('button', { name: '创建角色', exact: true }).click();
  await page.locator('#character-name').fill(`青石${suffix.slice(-5)}`);
  await page.getByRole('button', { name: '道士', exact: true }).click();
  await page.getByRole('button', { name: '创建并进入' }).click();
  await expect(page.locator('#player-hud')).toBeVisible();
  await expect(page.locator('#player-level')).toContainText('道士');
  await expect(page.locator('#inventory .filled')).toHaveCount(3);
  await expect(page.locator('#belt .filled')).toHaveCount(1);
  await expect(page.locator('#belt [data-item]')).toHaveCount(6);
  await expect(page.locator('#world')).toHaveAttribute('data-map-ready', 'true');
  expect(await page.locator('#world canvas').evaluate((canvas: HTMLCanvasElement) => [canvas.width, canvas.height])).toEqual([800, 600]);
  const layout = await page.evaluate(() => {
    const stage = document.querySelector('#app')!.getBoundingClientRect();
    const hud = document.querySelector('.bottom-bar')!.getBoundingClientRect();
    return { ratio: stage.width / stage.height, top: (hud.top - stage.top) * 800 / stage.width };
  });
  expect(layout.ratio).toBeCloseTo(4 / 3, 5);
  expect(layout.top).toBeCloseTo(349, 5);
  await page.getByRole('button', { name: '打开背包', exact: true }).click();
  await page.locator('#inventory').getByRole('button', { name: '木剑', exact: true }).dblclick();
  await page.keyboard.press('F10');
  await expect(page.locator('#equipment').getByRole('button', { name: '木剑', exact: true })).toBeVisible();
  await page.keyboard.press('F9');
  await expect(page.locator('#sidepanel')).toBeHidden();
  await expect(page.locator('#character-window')).toBeVisible();
  await page.keyboard.press('F9');
  await expect(page.locator('#inventory .filled')).toHaveCount(2);
  await page.locator('#belt').getByRole('button', { name: '金创药(小量)', exact: true }).click();
  await expect(page.locator('#health-count')).toHaveText('0');
  await expect(page.locator('#belt .filled')).toHaveCount(0);
  const initial = await page.locator('#coordinates').textContent();
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
    await page.keyboard.down(key);
    try { await expect(page.locator('#coordinates')).not.toHaveText(initial!, { timeout: 1500 }); }
    catch { /* A live actor can occupy an adjacent tile. */ }
    finally { await page.keyboard.up(key); }
    if (await page.locator('#coordinates').textContent() !== initial) break;
  }
  await expect(page.locator('#coordinates')).not.toHaveText(initial!);
  await page.keyboard.press('Enter');
  await page.locator('#chat-input').fill('青石镇出发');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('#chat-log')).toContainText('青石镇出发');
  await page.locator('#chat-input').blur();
  await page.keyboard.press('F9');
  await page.screenshot({ path: 'test-results/desktop.png' });
  const png = PNG.sync.read(await page.locator('#world canvas').screenshot());
  const colors = new Set();
  let dark = 0, pixels = 0;
  for (let y = 20; y < png.height - 20; y += 9) for (let x = 20; x < png.width - 20; x += 9) {
    const i = (y * png.width + x) * 4;
    colors.add(`${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`);
    pixels++; if (png.data[i] + png.data[i + 1] + png.data[i + 2] < 80) dark++;
  }
  expect(colors.size).toBeGreaterThan(35);
  expect(dark / pixels).toBeLessThan(0.75);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '退出游戏', exact: true }).click();
  await expect(page.locator('#auth-submit')).toBeVisible();
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const phone = await mobile.newPage();
  phone.on('pageerror', error => errors.push(error.message));
  phone.on('response', response => { if (response.status() >= 400 && response.url().includes('/assets/')) missing.push(`${response.status()} ${response.url()}`); });
  await phone.goto(baseURL!);
  await expect(phone.locator('#auth-submit')).toBeEnabled();
  await phone.locator('#account').fill(account);
  await phone.locator('#password').fill(password);
  await phone.waitForTimeout(2500);
  await phone.locator('#auth-submit').click();
  await expect(phone.getByRole('heading', { name: '选择角色' })).toBeVisible();
  await phone.locator('.character').click();
  await phone.locator('#start-character').click();
  await expect(phone.locator('#player-hud')).toBeVisible();
  await expect(phone.locator('#world')).toHaveAttribute('data-map-ready', 'true');
  await expect(phone.locator('#touch-pad')).toBeVisible();
  await phone.locator('#native-bag-toggle').tap();
  await phone.locator('#character-toggle').tap();
  await expect(phone.locator('#equipment').getByRole('button', { name: '木剑', exact: true })).toBeVisible();
  await phone.locator('#close-bag').tap();
  await phone.locator('#close-character').tap();
  await expect(phone.locator('#sidepanel')).toBeHidden();
  const beforeTouch = await phone.locator('#coordinates').textContent();
  for (const direction of [0, 2, 4, 6]) {
    await phone.locator(`[data-dir="${direction}"]`).tap();
    try { await expect(phone.locator('#coordinates')).not.toHaveText(beforeTouch!, { timeout: 1500 }); }
    catch { /* Try another adjacent tile if the native server blocks this one. */ }
    if (await phone.locator('#coordinates').textContent() !== beforeTouch) break;
  }
  await expect(phone.locator('#coordinates')).not.toHaveText(beforeTouch!);
  await phone.screenshot({ path: 'test-results/mobile.png' });
  const mobilePNG = PNG.sync.read(await phone.locator('#world canvas').screenshot());
  const mobileColors = new Set<string>();
  for (let y = 20; y < mobilePNG.height - 20; y += 9) for (let x = 20; x < mobilePNG.width - 20; x += 9) {
    const i = (y * mobilePNG.width + x) * 4;
    mobileColors.add(`${mobilePNG.data[i]},${mobilePNG.data[i + 1]},${mobilePNG.data[i + 2]}`);
  }
  expect(mobileColors.size).toBeGreaterThan(35);
  expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const selector of ['.bottom-bar', '#player-hud', '.actions', '#touch-pad']) {
    const box = await phone.locator(selector).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(391);
  }
  await phone.getByRole('button', { name: '退出游戏', exact: true }).click();
  await expect(phone.locator('#auth-submit')).toBeVisible();
  await mobile.close();
  expect(errors).toEqual([]);
  expect(missing).toEqual([]);
});
