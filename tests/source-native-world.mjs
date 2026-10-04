import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { PNG } from 'pngjs';

const before = process.env.MIR_MAP_BEFORE_URL ?? 'http://127.0.0.1:18880';
const after = process.env.MIR_MAP_AFTER_URL ?? 'http://127.0.0.1:18883';
const assets = process.env.MIR_SOURCE_ASSETS ?? '.runtime/native-world-fix/assets';
const destination = process.env.MIR_MAP_REPORT ?? '.runtime/reports/native-world-browser';
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const integration = await json(join(assets, 'integration.json'));
assert.equal(integration.mapResourceAcceptance, 'passed');
assert.deepEqual(integration.missingMapReferences, []);
assert.equal(integration.maps.find(map => map.id === '0').resourceNamespace, 'WemadeMir2');
const world = await json(join(assets, 'maps/0/map.json'));
const report = { checkedAt: new Date().toISOString(), before, after, passed: false,
  full176Acceptance: false, authenticated2003Client: false, sourceSha256: world.sourceSha256, scenes: [] };
const scenes = [
  { name: 'start', x: 289, y: 618 },
  { name: 'warehouse', x: 307, y: 627 },
  { name: 'city', x: 335, y: 299 },
  { name: 'city-south', x: 329, y: 337 },
  { name: 'southwest', x: 247, y: 664 },
  { name: 'northeast', x: 667, y: 94 },
  { name: 'forest-entrance', x: 324, y: 34 },
  { name: 'valley-entrance', x: 671, y: 82 }
];
await mkdir(destination, { recursive: true });
const browser = await chromium.launch({ headless: true });
function colors(image) {
  const values = new Set();
  for (let y = 0; y < image.height; y += 7) for (let x = 0; x < image.width; x += 7) {
    const offset = (y * image.width + x) * 4;
    values.add(image.data.subarray(offset, offset + 3).toString('hex'));
  }
  return values.size;
}
try {
  for (const scene of scenes) {
    const captures = [];
    for (const [kind, base] of [['before', before], ['after', after]]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors = [], missing = [], loaded = new Set();
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => {
        const path = new URL(response.url()).pathname;
        if (response.status() >= 400) missing.push({ path, status: response.status() });
        if (response.ok() && /^\/libraries\/.+\.png$/.test(path)) loaded.add(path);
      });
      try {
        await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('#status')).toContainText('地图 0', { timeout: 60000 });
        await page.locator('#x').fill(String(scene.x)); await page.locator('#y').fill(String(scene.y));
        await page.locator('#jump button').click();
        await expect(page.locator('#status')).toHaveText(new RegExp(`^地图 0 · ${scene.x}, ${scene.y} · \\d+ 个图块 · \\d+ 个未解析引用$`), { timeout: 60000 });
        const status = await page.locator('#status').textContent();
        const unresolved = Number(/(\d+) 个未解析引用/.exec(status)[1]);
        if (kind === 'after') assert.equal(unresolved, 0, scene.name);
        const bytes = await page.locator('#viewport canvas').screenshot();
        const image = PNG.sync.read(bytes), colorCount = colors(image);
        assert.ok(colorCount > 35, `${kind}/${scene.name}: blank canvas`);
        await page.screenshot({ path: join(destination, `${scene.name}-${kind}.png`) });
        let mobileColors;
        if (kind === 'after') {
          assert.ok([...loaded].every(path => !/BichonObjects(?:25[1-7])\//.test(path)), 'Mir3 namespace used by native Bichon');
          await page.setViewportSize({ width: 390, height: 844 });
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          mobileColors = colors(PNG.sync.read(await page.locator('#viewport canvas').screenshot()));
          assert.ok(mobileColors > 35);
          await page.screenshot({ path: join(destination, `${scene.name}-mobile.png`) });
        }
        assert.deepEqual(errors, []); assert.deepEqual(missing, []);
        captures.push({ image, sha256: digest(bytes), unresolved, colorCount, mobileColors, loaded: [...loaded], errors, missing });
      } finally {
        await page.close();
      }
    }
    assert.equal(captures[0].image.width, captures[1].image.width);
    assert.equal(captures[0].image.height, captures[1].image.height);
    let changedPixels = 0;
    for (let at = 0; at < captures[0].image.data.length; at += 4) if (!captures[0].image.data.subarray(at, at + 4).equals(captures[1].image.data.subarray(at, at + 4))) changedPixels++;
    report.scenes.push({ ...scene, changedPixels, beforeUnresolved: captures[0].unresolved,
      afterUnresolved: captures[1].unresolved, beforeCanvasSha256: captures[0].sha256,
      afterCanvasSha256: captures[1].sha256, desktopColors: captures[1].colorCount,
      mobileColors: captures[1].mobileColors, mobileOverflow: false,
      loadedLibraryNames: [...new Set(captures[1].loaded.map(path => path.split('/')[2]))].sort(),
      browserErrors: captures[1].errors, missingResources: captures[1].missing });
    console.log(`PASS ${scene.name}: zero unresolved references, desktop/mobile, ${changedPixels} changed pixels.`);
  }
  assert.ok(report.scenes.reduce((total, scene) => total + scene.changedPixels, 0) > 1000);
  report.passed = true;
} catch (error) {
  report.error = String(error);
  throw error;
} finally {
  await browser.close();
  await writeFile(join(destination, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
}
