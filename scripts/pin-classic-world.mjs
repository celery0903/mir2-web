import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const audit = JSON.parse(await readFile(resolve(process.argv[2] ?? 'docs/classic-world-audit.json')));
const libraries = resolve(process.argv[3] ?? '.runtime/wemade-mir2');
const lockFile = new URL('../shared/native-world.lock.json', import.meta.url);
const lock = JSON.parse(await readFile(lockFile));
assert.equal(audit.sourceRepository, lock.repository);
assert.equal(audit.sourceRevision, lock.revision);
assert.equal(audit.unsupportedMaps.length, 0);
assert.equal(audit.sourceBytesMatchPinnedGitTree, true, 'Audit did not verify the pinned source Git tree');
assert.equal(audit.maps.length, audit.mapCount);
assert.equal(new Set(audit.maps.map(map => map.id)).size, audit.maps.length, 'Duplicate map IDs');
for (const map of audit.maps) assert.match(map.gitBlob, /^[a-f0-9]{40}$/);
const rules = JSON.parse(await readFile(new URL('../shared/classic-map-library-rules.json', import.meta.url)));
assert.deepEqual(audit.libraryRules, rules, 'Library rules differ from the reviewed source reference');
const reference = await readFile(join(resolve(process.env.MIR_LEGACY_SOURCE ?? '.runtime/legacy-source'), rules.file));
assert.equal(createHash('sha256').update(reference).digest('hex'), rules.sha256, 'Pinned Pascal reference changed');
for (const existing of lock.maps) {
  const current = audit.maps.find(map => map.id === existing.id);
  assert.equal(current?.sha256, existing.sha256, `Pinned map changed: ${existing.id}`);
}
lock.maps = audit.maps.map(({ id, name, bytes, sha256, gitBlob, sourceFile, graphicID, group, flags, trailingBytes }) => ({ id, name, bytes, sha256, gitBlob, sourceFile, graphicID, group, flags, ...(trailingBytes ? { trailingBytes } : {}) }));
for (const name of audit.requiredLibraries) {
  const file = name + '.Lib';
  const raw = await readFile(join(libraries, file));
  const sha256 = createHash('sha256').update(raw).digest('hex');
  const old = lock.libraries.find(entry => entry.file === file);
  if (old) {
    assert.equal(raw.length, old.bytes); assert.equal(sha256, old.sha256);
  } else lock.libraries.push({ file, bytes: raw.length, sha256 });
}
lock.libraryRules = audit.libraryRules;
lock.sourceMapInfoSha256 = audit.sourceMapInfoSha256;
lock.sourceMapInfoGitBlob = audit.sourceMapInfoGitBlob;
lock.sourceMonGenGitBlob = audit.sourceMonGenGitBlob;
lock.interpretation = 'Pinned classic candidate catalog and converted WemadeMir2 libraries. defaultMapIDs controls the enabled native profile; other catalog entries require world, gameplay and source verification. Matching hashes and library routing do not authenticate the 2003 Shanda release.';
await writeFile(lockFile, JSON.stringify(lock, null, 2) + '\n');
console.log(`Pinned ${lock.maps.length} classic candidate maps and ${lock.libraries.length} map libraries; enabled native maps: ${lock.defaultMapIDs.length}.`);
