import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { archivedMapPins } from '../scripts/native-map.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const seed = join(root, '.runtime/mirserver-source');
const prepare = output => execFileSync(process.execPath, ['scripts/prepare-classic-world.mjs', seed, '.runtime/classic', output, '--all'], { cwd: root, encoding: 'utf8' });

test('full profile retains aliases, source flags, maze routes, start points, guards and drop dependencies', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'mir2-full-profile-'));
  try {
    prepare(fixture);
    const audit = JSON.parse(await readFile(join(fixture, 'audit.json')));
    assert.equal(audit.maps.length, 256);
    assert.equal(audit.connections, 1298);
    const mapInfo = await readFile(join(fixture, 'Envir/MapInfo.txt'), 'utf8');
    assert.match(mapInfo, /\[0123A\|0123\s/);
    assert.match(mapInfo, /D71601\s+17 12\s+->\s+D71609/);
    assert.match(mapInfo, /\[R001[^\]]+\].*NEEDHOLE/);
    const lock = JSON.parse(await readFile('shared/native-world.lock.json'));
    const archive = JSON.parse(await readFile('shared/archived-176-client.lock.json'));
    for (const pin of archivedMapPins(lock, archive)) {
      const bytes = await readFile(join(fixture, 'Map', pin.graphicID + '.map'));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256);
    }
    const cangyue = audit.maps.find(map => map.id === '5');
    assert.equal(cangyue.sourceKind, 'archived-client');
    assert.equal(cangyue.previousSource.sha256, lock.maps.find(map => map.id === '5').sha256);
    assert.equal(cangyue.installerSha256, archive.installer.sha256);
    assert.equal(audit.services['StartPoint.txt'], 8);
    assert.equal(audit.services['GuardList.txt'], 49);
    assert.ok(audit.dependencies.includes('MonItems/暗之虹魔教主.txt'));
    assert.ok(audit.dependencies.includes('Market_Def/传送员/进白日门-1.txt'));
    assert.ok(audit.dependencies.includes('MapQuest_def/Q001.txt'));
    assert.match(mapInfo, /\[D401[^\]]+\].*CHECKQUEST\(Q001\)/);
    const npcPaths = audit.scriptPaths.filter(entry => entry.source.startsWith('Npc_Def/'));
    assert.equal(npcPaths.length, 3);
    for (const entry of npcPaths) {
      assert.ok(entry.installed.startsWith('Npc_def/'));
      assert.ok((await readFile(join(fixture, 'Envir', entry.installed), 'utf8')).includes('[@'));
    }
    assert.equal(audit.candidateServiceAcceptance, 'failed');
    assert.equal(audit.full176Acceptance, false);
    assert.ok(audit.scriptFindings.some(entry => entry.kind === 'version-review-required'));
    assert.ok(audit.scriptFindings.some(entry => entry.kind === 'outside-catalog-map'));
    for (const file of audit.excludedGlobalHooks) assert.equal((await readFile(join(fixture, 'Envir', file), 'utf8')).trim(), '');
    const version = await readFile(join(fixture, 'profile.version'), 'utf8');
    prepare(fixture);
    assert.equal(await readFile(join(fixture, 'profile.version'), 'utf8'), version);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test('full profile rejects a modified spawn table rather than deriving an unpinned world', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'mir2-modified-profile-'));
  try {
    const source = join(fixture, 'seed');
    await mkdir(join(source, 'Mir200/Envir'), { recursive: true });
    await symlink(join(seed, 'Mir200/Map'), join(source, 'Mir200/Map'), 'dir');
    for (const file of ['MapInfo.txt', 'MonGen.txt']) {
      const raw = await readFile(join(seed, 'Mir200/Envir', file));
      const changed = Buffer.from(raw);
      if (file === 'MonGen.txt') changed[changed.length - 1] ^= 1;
      await writeFile(join(source, 'Mir200/Envir', file), changed);
    }
    const result = spawnSync(process.execPath, ['scripts/prepare-classic-world.mjs', source, '.runtime/classic', join(fixture, 'profile'), '--all'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /World service checksum mismatch: MonGen.txt/);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test('full profile rejects a modified archived map without falling back to the community seed', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'mir2-modified-archive-'));
  try {
    const directory = join(fixture, 'archive/map');
    await mkdir(directory, { recursive: true });
    const raw = Buffer.from(await readFile('.runtime/original-client-research/extracted/App_Executables/map/5.map'));
    raw[raw.length - 1] ^= 1;
    await writeFile(join(directory, '5.map'), raw);
    const result = spawnSync(process.execPath, ['scripts/prepare-classic-world.mjs', seed, '.runtime/classic', join(fixture, 'profile'), '--all'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, MIR_ARCHIVED_CLIENT: join(fixture, 'archive') }
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Native map checksum mismatch: 5/);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
