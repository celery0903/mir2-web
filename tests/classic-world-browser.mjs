import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { PNG } from 'pngjs';

const base = process.env.MIR_URL ?? 'http://127.0.0.1:18883';
const assets = process.env.MIR_SOURCE_ASSETS ?? '.runtime/classic-world/assets';
const destination = process.env.MIR_WORLD_REPORT ?? '.runtime/reports/classic-world-browser';
const audit = JSON.parse(await readFile('docs/classic-world-audit.json'));
const native = JSON.parse(await readFile(join(assets, 'native-world.json')));
const ids = process.env.MIR_WORLD_IDS?.split(',') ?? ['0', '1', '2', '3', '4', '5', '11', '12', '0140', '0123A', 'B341', 'B351', '1001', 'D001', 'D011',
  'D021', 'D024', 'D401', 'Q004', 'D501', 'D5061', 'D601', 'D716', 'D71601', 'D71625', 'D1002', 'D10061', 'D2000', 'D2013', 'D2051', 'D2067', 'D2079'];
const scenes = ids.map(id => {
  const map = audit.maps.find(map => map.id === id);
  const entrance = audit.connections.find(edge => edge.to === id && !edge.physicalIssue);
  assert.ok(entrance, `No valid entrance for ${id}`);
  return { id, name: map.name, x: entrance.targetX, y: entrance.targetY, expectedUnresolved: 0 };
});
if (!process.env.MIR_WORLD_IDS) scenes.push(
  { id: '4', name: 'fengmo-boundary', x: 8, y: 76, expectedUnresolved: 0 },
  { id: '5', name: 'cangyue-boundary', x: 8, y: 22, expectedUnresolved: 0 },
  { id: '11', name: 'white-sun-boundary', x: 8, y: 12, expectedUnresolved: 0 },
  { id: 'D714', name: 'stone-tomb-known-missing', x: 398, y: 199, expectedUnresolved: 3 }
);
const report = { checkedAt: new Date().toISOString(), url: base, passed: false, full176Acceptance: false,
  authenticated2003Client: false, candidateMapCount: native.maps.length,
  mapResourceAcceptance: native.mapResourceAcceptance, missingMapReferences: native.missingMapReferences,
  scope: 'Source H5 map renderer; candidate selection is not native gameplay or full-world activation', scenes: [] };
await mkdir(destination, { recursive: true });
const browser = await chromium.launch({ headless: true });
function colors(bytes) {
  const image = PNG.sync.read(bytes), values = new Set();
  for (let y = 0; y < image.height; y += 7) for (let x = 0; x < image.width; x += 7) {
    const at = (y * image.width + x) * 4;
    values.add(image.data.subarray(at, at + 3).toString('hex'));
  }
  return values.size;
}
try {
  assert.equal(native.maps.length, 249);
  for (const scene of scenes) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], missing = [], libraries = new Set();
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      const path = new URL(response.url()).pathname;
      if (response.status() >= 400) missing.push({ path, status: response.status() });
      if (response.ok() && /^\/libraries\/.+\.png$/.test(path)) libraries.add(path.split('/')[2]);
    });
    try {
      await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
      const selector = page.locator('#map');
      await expect(selector).toBeEnabled({ timeout: 60000 });
      assert.equal(await selector.locator('option').count(), 249);
      if (scene.id !== '0') {
        await selector.selectOption(scene.id);
        await expect(selector).toBeEnabled({ timeout: 60000 });
      }
      const world = JSON.parse(await readFile(join(assets, 'maps', scene.id, 'map.json')));
      await expect(page.locator('#x')).toHaveAttribute('max', String(world.width - 1));
      await expect(page.locator('#y')).toHaveAttribute('max', String(world.height - 1));
      await page.locator('#x').fill(String(scene.x));
      await page.locator('#y').fill(String(scene.y));
      await page.locator('#jump button').click();
      await expect(page.locator('#status')).toHaveText(new RegExp(`^地图 ${scene.id} · ${scene.x}, ${scene.y} · \\d+ 个图块 · ${scene.expectedUnresolved} 个未解析引用$`), { timeout: 60000 });
      const desktop = await page.locator('#viewport canvas').screenshot();
      const desktopColors = colors(desktop);
      assert.ok(desktopColors > 20, `Blank desktop canvas: ${scene.id}/${scene.name}`);
      await page.screenshot({ path: join(destination, `${scene.id}-${scene.x}-${scene.y}-desktop.png`) });
      await page.setViewportSize({ width: 390, height: 844 });
      const mobile = await page.locator('#viewport canvas').screenshot();
      const mobileColors = colors(mobile);
      assert.ok(mobileColors > 20, `Blank mobile canvas: ${scene.id}/${scene.name}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: join(destination, `${scene.id}-${scene.x}-${scene.y}-mobile.png`) });
      assert.deepEqual(errors, []);
      assert.deepEqual(missing, []);
      assert.ok([...libraries].every(name => !/^BichonObjects25/.test(name)));
      report.scenes.push({ ...scene, sourceSha256: world.sourceSha256, desktopColors, mobileColors,
        desktopCanvasSha256: createHash('sha256').update(desktop).digest('hex'),
        mobileCanvasSha256: createHash('sha256').update(mobile).digest('hex'),
        loadedLibraryNames: [...libraries].sort(), mobileOverflow: false, browserErrors: errors, missingResources: missing });
      console.log(`PASS ${scene.id}/${scene.name}: desktop/mobile, ${scene.expectedUnresolved} expected unresolved references.`);
    } catch (error) {
      report.failure = { scene, browserErrors: errors, missingResources: missing,
        layout: await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth })) };
      await page.screenshot({ path: join(destination, `${scene.id}-${scene.x}-${scene.y}-failure.png`) });
      throw error;
    } finally {
      await page.close();
    }
  }
  report.passed = true;
} catch (error) {
  report.error = String(error);
  throw error;
} finally {
  await browser.close();
  await writeFile(join(destination, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
}
