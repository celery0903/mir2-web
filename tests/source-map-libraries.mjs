import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { legacyMap, legacyTileRemap, collisionRows } from '../scripts/native-map.mjs';

const before = (process.env.MIR_MAP_BEFORE_URL ?? 'http://127.0.0.1:18880').replace(/\/$/, '');
const after = (process.env.MIR_MAP_AFTER_URL ?? 'http://127.0.0.1:18884').replace(/\/$/, '');
const assets = process.env.MIR_MAP_ASSETS ?? '.runtime/source-map-fix/assets';
const destination = process.env.MIR_MAP_REPORT ?? '.runtime/reports/source-map-libraries';
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const classic = await json('.runtime/classic/manifest.json');
const lock = await json('shared/classic-assets.lock.json');
const world = await json(join(assets, 'maps/0/map.json'));
const integration = await json(join(assets, 'integration.json'));
const report = { checkedAt: new Date().toISOString(), before, after, passed: false, correctionChecksPassed: false, mapResourceAcceptance: 'failed', full176Acceptance: false, missingMapReferences: integration.missingMapReferences, scenes: [] };
await mkdir(destination, { recursive: true });

const raw = await readFile('.runtime/classic/server-maps/0.map');
const rawPin = lock.files.find(entry => entry.file === 'server-maps/0.map');
assert.equal(raw.length, rawPin.bytes);
assert.equal(createHash('sha1').update(`blob ${raw.length}\0`).update(raw).digest('hex'), rawPin.sha);
const native = legacyMap(raw), remap = legacyTileRemap(raw);
assert.equal(digest(native), world.sourceSha256);
const prior = Buffer.from(native);
let remappedTileCells = 0, nonDefaultFrontCells = 0;
for (let cell = 0; cell < world.width * world.height; cell++) {
  const from = 8 + cell * 26, to = 52 + cell * 12;
  const back = raw.readUInt32LE(from + 2), image = back & 0x1fffffff;
  const index = (raw.readUInt16LE(from + 12) & 0x7fff) - 1;
  assert.equal(native.readUInt16LE(to) & 0x7fff, remap[image] ?? image);
  assert.equal(Boolean(native.readUInt16LE(to) & 0x8000), Boolean(back & 0x20000000));
  assert.equal(native.readUInt16LE(to + 4), raw.readUInt16LE(from + 12));
  assert.ok(native.subarray(to + 6, to + 10).equals(raw.subarray(from + 14, from + 18)));
  if (index >= 0 && index < 0x7eff) {
    const family = raw.readInt16LE(from + 10);
    assert.equal(native[to + 10], family - 2);
    assert.equal(world.objectLibraries[family - 2], family === 2 ? 'Objects' : `BichonObjects${family}`);
    if (family !== 2) nonDefaultFrontCells++;
  }
  if (remap[image]) {
    remappedTileCells++;
    assert.equal(world.tileSourceIndices[(native.readUInt16LE(to) & 0x7fff) - 1], image - 1);
  }
  prior.writeUInt16LE((back & 0x7fff) | (back & 0x20000000 ? 0x8000 : 0), to);
  prior[to + 10] = 0;
}
assert.deepEqual(collisionRows(native), collisionRows(prior));
report.mapConversion = { cellsChecked: world.width * world.height, sourceSha256: digest(raw), nativeSha256: digest(native), collisionUnchanged: true, nonDefaultFrontCells, remappedTileCells, remappedTileImages: Object.keys(remap).length };

const atlasCache = new Map();
const libraries = new Map();
async function atlas(file) {
  if (!atlasCache.has(file)) {
    const bytes = await readFile(join('.runtime/classic', file));
    const pin = lock.files.find(entry => entry.file === file);
    assert.ok(pin, `Unpinned atlas ${file}`);
    assert.equal(bytes.length, pin.bytes);
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), pin.sha);
    atlasCache.set(file, PNG.sync.read(bytes));
  }
  return atlasCache.get(file);
}
let comparedFrames = 0, comparedPixels = 0;
for (const name of ['Tiles', 'SmTiles', ...new Set(Object.values(world.objectLibraries))]) {
  const library = await json(join(assets, 'libraries', name, 'library.json'));
  libraries.set(name, library);
  assert.equal(library.sourceManifest, 'manifest.json');
  for (const [index, frame] of Object.entries(library.frames)) {
    const original = classic.frames[`${library.sourceLibrary}:${frame.sourceIndex ?? index}`];
    assert.ok(original, `${name}/${index} is absent from the source atlas`);
    const source = await atlas(classic.atlases[original.atlas].file);
    const bytes = await readFile(join(assets, 'libraries', name, frame.file));
    assert.equal(digest(bytes), frame.sha256);
    const exported = PNG.sync.read(bytes);
    assert.equal(exported.width, original.w); assert.equal(exported.height, original.h);
    for (let y = 0; y < original.h; y++) {
      const start = ((original.y + y) * source.width + original.x) * 4;
      assert.equal(exported.data.subarray(y * original.w * 4, (y + 1) * original.w * 4).equals(source.data.subarray(start, start + original.w * 4)), true, `${name}/${index} row ${y}`);
    }
    comparedFrames++; comparedPixels += original.w * original.h;
  }
}
atlasCache.clear();
report.pinnedAtlasComparison = { comparedFrames, comparedPixels, allRgbaPixelsMatch: true };
console.log(`PASS ${comparedFrames} exported map frames, ${comparedPixels} pixels match pinned source atlases.`);

function colors(image) {
  const values = new Set();
  for (let y = 0; y < image.height; y += 7) for (let x = 0; x < image.width; x += 7) {
    const at = (y * image.width + x) * 4;
    values.add(image.data.subarray(at, at + 3).toString('hex'));
  }
  return values.size;
}
function sourceGaps(scene) {
  const gaps = [], knownMissing = new Set(classic.missingReferences.map(entry => entry.key));
  for (let y = Math.max(0, scene.y - 14); y <= Math.min(world.height - 1, scene.y + 24); y++) {
    for (let x = Math.max(0, scene.x - 12); x <= Math.min(world.width - 1, scene.x + 12); x++) {
      const at = 52 + (x * world.height + y) * 12;
      for (let layer = 0; layer < 3; layer++) {
        if (layer === 0 && (x % 2 || y % 2)) continue;
        const index = (native.readUInt16LE(at + layer * 2) & 0x7fff) - 1;
        if (index < 0 || index >= 0x7eff) continue;
        const name = layer === 2 ? world.objectLibraries[native[at + 10]] : ['Tiles', 'SmTiles'][layer];
        const library = libraries.get(name);
        const count = layer === 2 && library.frames[index] ? Math.max(1, native[at + 8] & 127) : 1;
        for (let n = 0; n < count; n++) {
          if (library.frames[index + n] || library.empty.includes(index + n)) continue;
          const key = `${library.sourceLibrary}:${library.sourceIndices[index + n] ?? index + n}`;
          assert.equal(classic.frames[key], undefined, `${name}/${index + n} was lost in conversion`);
          assert.ok(knownMissing.has(key) || !classic.emptyFrames.includes(key), `${key} empty frame was lost`);
          gaps.push({ x, y, layer, library: name, index: index + n, sourceKey: key, recordedMissingInSource: knownMissing.has(key) });
        }
      }
    }
  }
  return gaps;
}
const scenes = [
  { name: 'boundary', x: 315, y: 645, library: 'BichonObjects7' },
  { name: 'city', x: 282, y: 319, library: 'BichonObjects24' },
  { name: 'city-south', x: 329, y: 337, library: 'BichonObjects21' },
  { name: 'southwest', x: 247, y: 664, library: 'BichonObjects5' },
  { name: 'northeast', x: 667, y: 94, library: 'BichonObjects22' },
  { name: 'wide-tiles', x: 548, y: 604 },
];
const browser = await chromium.launch({ headless: true });
try {
  for (const scene of scenes) {
    const captures = [], gaps = sourceGaps(scene);
    for (const [kind, url] of [['before', before], ['after', after]]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors = [], failedRequests = [], loaded = new Set();
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => {
        const path = new URL(response.url()).pathname;
        if (response.status() >= 400) failedRequests.push({ path, status: response.status() });
        if (response.ok() && /^\/libraries\/.+\.png$/.test(path)) loaded.add(path);
      });
      await page.goto(`${url}/index.html`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#status')).toContainText('地图 0', { timeout: 60000 });
      await page.locator('#x').fill(String(scene.x)); await page.locator('#y').fill(String(scene.y));
      await page.locator('#jump button').click();
      await expect(page.locator('#status')).toHaveText(new RegExp(`^地图 0 · ${scene.x}, ${scene.y} · \\d+ 个图块 · \\d+ 个未解析引用$`), { timeout: 60000 });
      const status = await page.locator('#status').textContent();
      const unresolved = Number(/(\d+) 个未解析引用/.exec(status)?.[1]);
      assert.ok(Number.isFinite(unresolved), status);
      if (kind === 'after') assert.equal(unresolved, gaps.length, `${scene.name}: unresolved references must match source gaps`);
      const png = await page.locator('#viewport canvas').screenshot();
      const image = PNG.sync.read(png);
      assert.ok(colors(image) > 35, `${kind} ${scene.name}: blank canvas`);
      await page.screenshot({ path: `${destination}/${scene.name}-${kind}.png` });
      assert.deepEqual(errors, []); assert.deepEqual(failedRequests, []);
      if (kind === 'after') {
        if (scene.library) assert.ok([...loaded].some(path => path.startsWith(`/libraries/${scene.library}/`)), `${scene.name} did not load its original library`);
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.ok(colors(PNG.sync.read(await page.locator('#viewport canvas').screenshot())) > 35);
        await page.screenshot({ path: `${destination}/${scene.name}-mobile.png` });
      }
      captures.push({ image, sha256: digest(png), unresolved, loaded: [...loaded].filter(path => path.startsWith(`/libraries/${scene.library ?? 'Tiles'}/`)).length });
      await page.close();
    }
    assert.equal(captures[0].image.width, captures[1].image.width);
    assert.equal(captures[0].image.height, captures[1].image.height);
    let changedPixels = 0;
    for (let offset = 0; offset < captures[0].image.data.length; offset += 4) if (!captures[0].image.data.subarray(offset, offset + 4).equals(captures[1].image.data.subarray(offset, offset + 4))) changedPixels++;
    assert.ok(changedPixels > 1000, `${scene.name}: expected corrected scenery to alter the canvas`);
    report.scenes.push({ ...scene, changedPixels, beforeUnresolved: captures[0].unresolved, afterUnresolved: captures[1].unresolved, sourceGaps: gaps, resourceAcceptance: gaps.length ? 'failed' : 'passed', beforeCanvasSha256: captures[0].sha256, afterCanvasSha256: captures[1].sha256, originalLibraryTexturesLoaded: captures[1].loaded, desktopAndMobileCanvasNonblank: true, mobileOverflow: false });
    console.log(`PASS correction ${scene.name}: ${changedPixels} changed canvas pixels, ${gaps.length} unresolved source references, desktop/mobile.`);
  }
  report.correctionChecksPassed = true;
  report.passed = integration.missingMapReferences.length === 0;
  report.mapResourceAcceptance = report.passed ? 'passed' : 'failed';
  console.log(`Correction checks passed; full map resources: ${report.mapResourceAcceptance}.`);
} finally {
  await browser.close();
  await writeFile(join(destination, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
}
