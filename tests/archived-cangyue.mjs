import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const assets = process.env.MIR_SOURCE_ASSETS ?? '.runtime/classic-world/assets';
const profile = process.env.MIR_WORLD_PROFILE ?? '.runtime/classic-world/profile';
const source = process.env.MIR_ARCHIVED_CLIENT ?? '.runtime/original-client-research/extracted/App_Executables';
const destination = process.env.MIR_CANGYUE_REPORT ?? '.runtime/reports/archived-cangyue';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path));
const archive = await json('shared/archived-176-client.lock.json');
const world = await json('shared/native-world.lock.json');
const original = await readFile(join(source, 'map/5.map'));
const candidate = await readFile('.runtime/mirserver-source/Mir200/Map/5.map');
const pin = archive.clientFiles.find(pin => pin.file === 'map/5.map');
assert.equal(original.length, pin.bytes);
assert.equal(digest(original), pin.sha256);
assert.equal(digest(candidate), world.maps.find(map => map.id === '5').sha256);
assert.ok((await readFile(join(profile, 'Map/5.map'))).equals(original), 'Server profile does not use the whole original map');
const manifest = await json(join(assets, 'maps/5/map.json'));
assert.equal(manifest.sourceSha256, pin.sha256);
assert.equal(manifest.sourceKind, 'archived-client');
assert.equal(manifest.installerSha256, archive.installer.sha256);
const height = original.readUInt16LE(2), width = original.readUInt16LE(0);
assert.deepEqual([width, height], [800, 800]);
const reconstructed = Buffer.alloc(original.length);
original.copy(reconstructed, 0, 0, 52);
const covered = new Uint8Array(width * height);
for (const chunk of manifest.chunks) {
  const bytes = await readFile(join(assets, 'maps/5', chunk.file));
  assert.equal(digest(bytes), chunk.sha256);
  assert.equal(bytes.length, chunk.width * chunk.height * 12);
  for (let x = 0; x < chunk.width; x++) for (let y = 0; y < chunk.height; y++) {
    const cell = (chunk.x + x) * height + chunk.y + y;
    assert.equal(covered[cell], 0);
    covered[cell] = 1;
    const from = (x * chunk.height + y) * 12;
    bytes.copy(reconstructed, 52 + cell * 12, from, from + 12);
  }
}
assert.ok(covered.every(Boolean));
assert.ok(reconstructed.equals(original), 'Browser cells differ from the original map');
const changed = [], collisions = [], fieldDifferences = Array(12).fill(0);
const blocked = (bytes, at) => Boolean((bytes.readUInt16LE(at) | bytes.readUInt16LE(at + 4)) & 0x8000);
for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) {
  const at = 52 + (x * height + y) * 12;
  if (original.subarray(at, at + 12).equals(candidate.subarray(at, at + 12))) continue;
  changed.push({ x, y, archive: [...original.subarray(at, at + 12)], candidate: [...candidate.subarray(at, at + 12)] });
  for (let field = 0; field < 12; field++) fieldDifferences[field] += original[at + field] !== candidate[at + field];
  if (blocked(original, at) !== blocked(candidate, at)) collisions.push({ x, y, archiveBlocked: blocked(original, at), candidateBlocked: blocked(candidate, at) });
}
assert.equal(changed.length, 304);
assert.equal(collisions.length, 7);
const changedCellBytes = fieldDifferences.reduce((sum, count) => sum + count, 0);
const headerByteDifferences = [...original.subarray(0, 52)].filter((value, at) => value !== candidate[at]).length;
const changedBounds = { minX: Math.min(...changed.map(cell => cell.x)), maxX: Math.max(...changed.map(cell => cell.x)),
  minY: Math.min(...changed.map(cell => cell.y)), maxY: Math.max(...changed.map(cell => cell.y)) };
assert.equal(changedCellBytes, 480);
assert.equal(headerByteDifferences, 5);
assert.deepEqual(changedBounds, { minX: 125, maxX: 156, minY: 323, maxY: 348 });
const audit = await json('docs/classic-world-audit.json');
const routes = audit.connections.filter(route => route.from === '5' || route.to === '5');
for (const route of routes) for (const [id, x, y] of [[route.from, route.x, route.y], [route.to, route.targetX, route.targetY]]) {
  if (id !== '5') continue;
  const at = 52 + (x * height + y) * 12;
  assert.equal(blocked(original, at), blocked(candidate, at), 'Source route collision changed');
  assert.equal(original[at + 6], candidate[at + 6], 'Source route door changed');
}
await mkdir(destination, { recursive: true });
await writeFile(join(destination, 'evidence.json'), JSON.stringify({ checkedAt: new Date().toISOString(), passed: true,
  archive: archive.archive, installerSha256: archive.installer.sha256, mapSha256: pin.sha256,
  candidateSha256: digest(candidate), wholeServerMapMatches: true, browserCellsChecked: width * height,
  browserCellsMatch: true, fieldDifferences, changedCellBytes, headerByteDifferences, changedBounds,
  changedCells: changed, collisions, routesWithUnchangedCollisionAndDoors: routes,
  authenticated2003Client: false, full176Acceptance: false }, null, 2) + '\n');
console.log(`Original Cangyue: ${width * height} browser cells match; ${changed.length} changed cells and ${collisions.length} collision changes; ${routes.length} source routes retain collision/door data.`);
