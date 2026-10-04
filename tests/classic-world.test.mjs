import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = resolve(new URL('..', import.meta.url).pathname);
const audit = JSON.parse(await readFile(join(root, 'docs/classic-world-audit.json')));
const lockFile = join(root, 'shared/native-world.lock.json');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('candidate maps match pinned source bytes and preserve lowercase files, aliases and maze routes', async () => {
  assert.equal(audit.sourceBytesMatchPinnedGitTree, true);
  assert.equal(audit.mapCount, 256);
  assert.equal(audit.recognizedMaps, 256);
  assert.deepEqual(audit.unsupportedMaps, []);
  assert.equal(audit.maps.find(map => map.id === 'D421').sourceFile, 'd421.map');
  const alias = audit.maps.find(map => map.id === '0123A');
  assert.equal(alias.sourceFile, '0123.map');
  assert.equal(alias.sha256, audit.maps.find(map => map.id === '0123').sha256);
  assert.ok(audit.connections.some(edge => edge.from === 'D71601' && edge.to === 'D71609' && edge.source.includes('17 12')));
  assert.equal(audit.physicalConnectionIssues, 6);
  const lock = JSON.parse(await readFile(lockFile));
  assert.deepEqual(lock.defaultMapIDs, ['0', '0102', '0103', '0104', '0105', '0106', '0108', '0109', '0132', '0140', '0141']);
  assert.equal(lock.maps.length, 256);
  assert.equal(lock.authenticated2003Client, false);
});

test('six armour areas retain source entrances, hole conditions and the exact death-temple auxiliary tail', async () => {
  const ids = ['R001', 'T232', 'T218', 'T339', 'T219', 'T315', 'T140'];
  assert.deepEqual(audit.maps.filter(map => map.group === 'six-armour-areas').map(map => map.id), ids);
  const death = audit.maps.find(map => map.id === 'T218');
  assert.equal(death.width, 30);
  assert.equal(death.height, 30);
  assert.equal(death.trailingBytes, 9840);
  assert.equal(death.bytes, 52 + 30 * 30 * 12 + 9840);
  assert.match(audit.maps.find(map => map.id === 'R001').flags, /NEEDHOLE/);
  for (const id of ids.filter(id => id !== 'T140')) assert.ok(audit.connections.some(edge => edge.to === id), `No native entrance to ${id}`);
  assert.ok(audit.connections.some(edge => edge.from === 'R001' && edge.to === 'T140'));
  assert.deepEqual(Object.keys(death.spawnNames), ['暗之虹魔教主']);
});

test('audit refuses modified source declarations before deriving a world', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'mir2-world-audit-'));
  try {
    const source = await readFile(join(root, '.runtime/mirserver-source/Mir200/Envir/MapInfo.txt'));
    const changed = Buffer.from(source);
    changed[changed.length - 1] ^= 1;
    await mkdir(join(fixture, 'Mir200/Envir'), { recursive: true });
    await writeFile(join(fixture, 'Mir200/Envir/MapInfo.txt'), changed);
    const result = spawnSync(process.execPath, ['scripts/audit-classic-world.mjs', fixture, join(fixture, 'audit.json')], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Source Git blob mismatch: Mir200\/Envir\/MapInfo.txt/);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('pinning refuses an audit without source verification and retains the current lock', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'mir2-world-pin-'));
  const before = digest(await readFile(lockFile));
  try {
    await writeFile(join(fixture, 'audit.json'), JSON.stringify({ ...audit, sourceBytesMatchPinnedGitTree: false }));
    const result = spawnSync(process.execPath, ['scripts/pin-classic-world.mjs', join(fixture, 'audit.json')], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Audit did not verify the pinned source Git tree/);
    assert.equal(digest(await readFile(lockFile)), before);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
