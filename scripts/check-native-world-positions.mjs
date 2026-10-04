import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';

const execute = promisify(execFile);
const project = process.env.MIR_PROJECT ?? 'mir2-web';
const maps = resolve(process.env.MIR_SOURCE_MAPS ?? '.runtime/classic-profile/Map');
const previousMaps = process.env.MIR_PREVIOUS_MAPS;
const destination = process.env.MIR_POSITION_REPORT ?? '.runtime/reports/native-world-positions.json';
assert.match(project, /^[a-z0-9][a-z0-9_-]*$/);
const lock = JSON.parse(await readFile(new URL('../shared/native-world.lock.json', import.meta.url)));
const sql = 'SELECT Id,MapName,CX,CY FROM characters WHERE COALESCE(Deleted,0)=0';
const { stdout } = await execute('docker', ['exec', `${project}-db-1`, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --default-character-set=utf8mb4 -uroot --batch --raw --skip-column-names mir2_db -e "$1"', 'sh', sql]);
const characters = stdout.trim().split('\n').filter(Boolean).map(line => {
  const [id, map, x, y] = line.split('\t');
  return { id: Number(id), map, x: Number(x), y: Number(y) };
});
const digest = data => createHash('sha256').update(data).digest('hex');
function blocked(data, x, y) {
  const width = data.readUInt16LE(0), height = data.readUInt16LE(2);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) return true;
  const offset = 52 + (x * height + y) * 12;
  return Boolean((data.readUInt16LE(offset) | data.readUInt16LE(offset + 4)) & 0x8000);
}
const results = [];
for (const id of lock.defaultMapIDs) {
  const pin = lock.maps.find(map => map.id === id);
  const next = await readFile(`${maps}/${id}.map`);
  assert.equal(next.length, pin.bytes);
  assert.equal(digest(next), pin.sha256);
  const prior = previousMaps ? await readFile(`${resolve(previousMaps)}/${id}.map`) : (await execute('docker', ['exec', `${project}-engine-1`, 'cat', `/data/server/Mir200/Map/${id}.map`], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 })).stdout;
  const occupants = characters.filter(character => character.map === id);
  const newlyBlocked = occupants.filter(character => !blocked(prior, character.x, character.y) && blocked(next, character.x, character.y));
  results.push({ id, previousSha256: digest(prior), proposedSha256: pin.sha256,
    charactersChecked: occupants.length, newlyBlocked, previouslyBlocked: occupants.filter(character => blocked(prior, character.x, character.y)).length });
}
const report = { checkedAt: new Date().toISOString(), project, readOnly: true,
  savedPositionsOnly: true, checkAgainAfterNativeSaveBeforeDeployment: true,
  passed: results.every(map => !map.newlyBlocked.length), maps: results };
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
assert.equal(report.passed, true, 'The proposed map would block saved character positions');
console.log(`PASS ${results.reduce((total, map) => total + map.charactersChecked, 0)} saved positions; no newly blocked characters.`);
