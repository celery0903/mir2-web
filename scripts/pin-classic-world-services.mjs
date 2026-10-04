import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const source = resolve(process.argv[2] ?? '.runtime/mirserver-source');
const repository = resolve(process.argv[3] ?? 'upstream/mir2-client/vendor/mirserver-data');
const pin = JSON.parse(await readFile('shared/server-data.lock.json'));
const commit = execFileSync('git', ['-C', repository, 'rev-parse', '--verify', `${pin.revision}^{commit}`], { encoding: 'utf8' }).trim();
assert.equal(commit, pin.revision);
const inputs = ['MapInfo.txt', 'MonGen.txt', 'MerChant.txt', 'Npcs.txt', 'GuardList.txt', 'StartPoint.txt', 'MapQuest.txt'];
const directories = ['Market_Def', 'Npc_Def', 'MapQuest_def', 'MonItems'];
const tree = execFileSync('git', ['-C', repository, 'ls-tree', '-rz', commit, '--', ...[...inputs, ...directories].map(file => `Mir200/Envir/${file}`)], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const files = [];
for (const entry of tree.split('\0').filter(Boolean)) {
  const match = /^100644 blob ([a-f0-9]{40})\t(Mir200\/Envir\/.+)$/.exec(entry);
  assert.ok(match, `Unsupported source entry: ${entry}`);
  const raw = await readFile(join(source, match[2]));
  const blob = createHash('sha1').update(`blob ${raw.length}\0`).update(raw).digest('hex');
  assert.equal(blob, match[1], `Modified source: ${match[2]}`);
  files.push({ file: match[2].slice('Mir200/Envir/'.length), bytes: raw.length, gitBlob: blob, sha256: createHash('sha256').update(raw).digest('hex') });
}
assert.ok(inputs.every(file => files.some(entry => entry.file === file)));
await writeFile('shared/classic-world-services.lock.json', JSON.stringify({ repository: pin.repository, revision: commit, authenticated2003Data: false, files }, null, 2) + '\n');
console.log(`Pinned ${files.length} world-service inputs to ${pin.repository}@${commit}; version authenticity remains unproven.`);
