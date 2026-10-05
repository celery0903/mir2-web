import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadClassicSkills } from './classic-skills.mjs';

const execute = promisify(execFile);
const project = process.argv[2] ?? 'mir2-web';
assert.match(project, /^[a-z0-9][a-z0-9_-]*$/);
const destination = resolve(process.argv[3] ?? `.runtime/reports/classic-items-${project}`);
await mkdir(destination, { recursive: true });
const work = await mkdtemp(resolve('.runtime/item-audit-'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sql = async query => (await execute('docker', ['exec', `${project}-db-1`, 'sh', '-c',
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --default-character-set=utf8mb4 -uroot --batch --raw --skip-column-names -e "$1"', 'sh', query],
  { maxBuffer: 16 * 1024 * 1024 })).stdout;
const columns = (await sql('SHOW COLUMNS FROM mir2_data.stditems')).trim().split('\n').map(line => line.split('\t')[0]);
for (const column of columns) assert.match(column, /^[A-Za-z0-9_]+$/);
const object = columns.map(column => `'${column}',\`${column}\``).join(',');
const rows = (await sql(`SELECT JSON_OBJECT(${object}) FROM mir2_data.stditems ORDER BY Id`)).trim().split('\n').filter(Boolean).map(JSON.parse);
assert.equal(new Set(rows.map(row => row.Id)).size, rows.length, 'Duplicate native item IDs');
const savedReferences = [];
for (const table of ['characters_item', 'characters_bagitem', 'characters_storageitem']) {
  const output = await sql(`SELECT StdIndex,COUNT(*) FROM mir2_db.${table} GROUP BY StdIndex ORDER BY StdIndex`);
  savedReferences.push(...output.trim().split('\n').filter(Boolean).map(line => {
    const [index, count] = line.split('\t').map(Number); return { table, index, count };
  }));
}
const snapshot = { checkedAt: new Date().toISOString(), project, rows, definitionsSha256: digest(JSON.stringify(rows)), savedReferences, readOnly: true };
await writeFile(join(destination, 'snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n');
await execute('docker', ['cp', `${project}-engine-1:/data/server/Mir200/Envir`, work]);
await execute('docker', ['cp', `${project}-engine-1:/engine`, work]);
async function fileHashes(directory, relative = '') {
  const hashes = {};
  for (const entry of (await readdir(join(directory, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = join(relative, entry.name);
    if (entry.isDirectory()) Object.assign(hashes, await fileHashes(directory, file));
    else if (entry.isFile()) hashes[file] = digest(await readFile(join(directory, file)));
    else throw new Error(`Unexpected snapshot file type: ${file}`);
  }
  return hashes;
}
const scriptHashesBefore = await fileHashes(join(work, 'Envir'));
const checks = join(work, 'checks'); await mkdir(checks);
for (const file of ['Program.cs', 'ItemAudit.csproj']) await copyFile(join('scripts/item-audit', file), join(checks, file));
let result;
try {
  result = await execute('docker', ['run', '--rm', '--network', 'none',
  // Native StringList opens files read/write. Only this private copy is writable.
  '-v', `${work}/engine:/engine:ro`, '-v', `${work}/Envir:/snapshot`, '-v', `${checks}:/tests`,
  '-v', `${destination}:/output`, 'mcr.microsoft.com/dotnet/sdk:8.0',
  'dotnet', 'run', '--project', '/tests/ItemAudit.csproj', '-c', 'Release', '--', '/snapshot', '/output/native-references.json'],
    { timeout: 120000, maxBuffer: 1024 * 1024 });
} catch (error) {
  await writeFile(join(destination, 'native-output.log'), (error.stdout ?? '') + (error.stderr ?? ''));
  await writeFile(join(destination, 'evidence.json'), JSON.stringify({ project, readOnly: true, full176Acceptance: false,
    auditCompleted: false, error: String(error), definitionsSha256: snapshot.definitionsSha256 }, null, 2) + '\n');
  throw error;
}
await writeFile(join(destination, 'native-output.log'), result.stdout + result.stderr);
const native = JSON.parse(await readFile(join(destination, 'native-references.json')));
assert.deepEqual(await fileHashes(join(work, 'Envir')), scriptHashesBefore, 'Native parsing changed its private source snapshot');
for (const [file, hash] of Object.entries(native.assemblies))
  assert.equal(digest(await readFile(join(work, 'engine/GameSrv', file))), hash, `Loaded assembly differs from ${project}: ${file}`);
const runningHashes = (await execute('docker', ['exec', `${project}-engine-1`, 'sha256sum',
  ...Object.keys(native.assemblies).map(file => `/data/server/Mir200/${file}`)])).stdout;
const runningAssemblies = Object.fromEntries(runningHashes.trim().split('\n').map(line => {
  const [hash, file] = line.trim().split(/\s+/); return [file.split('/').at(-1), hash];
}));
assert.deepEqual(runningAssemblies, native.assemblies, 'Running DLLs differ from the native audit assemblies');
const policy = await loadClassicSkills();
const names = new Set(policy.skills.map(skill => skill.name));
const books = rows.filter(row => row.StdMode === 4);
const retained = books.filter(row => names.has(row.Name));
for (const name of names) assert.equal(retained.filter(row => row.Name === name).length, 1, `Missing or duplicate classic book: ${name}`);
const outsideBooks = books.filter(row => !names.has(row.Name));
const outsideIDs = new Set(outsideBooks.map(row => row.Id));
const byName = new Map();
for (const row of rows) { const group = byName.get(row.Name) ?? []; group.push(row.Id); byName.set(row.Name, group); }
const references = native.references.map(reference => ({ ...reference, ids: byName.get(reference.name) ?? [],
  status: reference.dynamic ? 'dynamic-unverified' : reference.currency ? 'native-currency' : !byName.has(reference.name) ? 'missing-definition'
    : byName.get(reference.name).length > 1 ? 'ambiguous-definition' : outsideIDs.has(byName.get(reference.name)[0]) ? 'outside-classic-book-scope' : 'resolved-identity-only' }));
const positiveSaved = savedReferences.filter(reference => reference.index > 0).map(reference => ({ ...reference,
  name: rows.find(row => row.Id === reference.index)?.Name ?? null, outsideBookScope: outsideIDs.has(reference.index) }));
const engine = JSON.parse((await execute('docker', ['inspect', `${project}-engine-1`])).stdout)[0];
const evidence = { checkedAt: new Date().toISOString(), project, readOnly: true, auditCompleted: true, full176Acceptance: false, authenticated2003Data: false,
  definitionsSha256: snapshot.definitionsSha256, definitionRows: rows.length, allDefinitionColumns: columns,
  engine: { image: engine.Image, id: engine.Id, startedAt: engine.State.StartedAt, health: engine.State.Health?.Status },
  assemblies: native.assemblies, runningAssemblies, classicPolicySha256: digest(await readFile('shared/classic-skills.json')),
  privateScriptSnapshotPreserved: true, privateScriptSnapshotFiles: Object.keys(scriptHashesBefore).length,
  privateScriptSnapshotSha256: digest(JSON.stringify(scriptHashesBefore)),
  books: { rows: books.length, classic: retained.map(row => ({ id: row.Id, name: row.Name })), outside: outsideBooks.map(row => ({ id: row.Id, name: row.Name })) },
  definitions: rows.map(row => ({ id: row.Id, name: row.Name, stdMode: row.StdMode,
    classification: row.StdMode === 4 ? names.has(row.Name) ? 'classic-book-identity' : 'outside-classic-book-scope' : 'unverified-nonbook' })),
  zeroSavedSlots: savedReferences.filter(reference => reference.index === 0), positiveSaved,
  orphanSaved: positiveSaved.filter(reference => reference.name === null),
  outsideBookSaved: positiveSaved.filter(reference => reference.outsideBookScope),
  duplicateNames: [...byName].filter(([, ids]) => ids.length > 1).map(([name, ids]) => ({ name, ids })),
  references, missingReferences: references.filter(reference => reference.status === 'missing-definition'),
  outsideBookReferences: references.filter(reference => reference.status === 'outside-classic-book-scope'),
  referenceAcceptance: references.some(reference => ['missing-definition', 'ambiguous-definition', 'outside-classic-book-scope'].includes(reference.status))
    || native.nativeLog.some(entry => entry.level === 'Error') ? 'failed' : 'unverified',
  native: { loadedMaps: native.loadedMaps, declarations: native.declarations, scriptRoots: native.scriptRoots,
    spawnMonsters: native.spawnMonsters, files: native.files, findings: native.findings, log: native.nativeLog },
  limitations: [
    'The native compiler supplies script semantics, goods and drop names; compiling a branch does not prove players can execute it.',
    'Dynamic commands, item commands outside the explicitly checked set and include source closure require review; findings prevent complete reference acceptance.',
    'Only character SQL saved indices are included. Merchant inventory files, trade and market blobs, initial-item rules, recipes and hard-coded item creation require separate migration guards.',
    'Every SQL definition is included; non-book identities and all numerical values remain unverified. This report does not delete or replace data.'
  ] };
await writeFile(join(destination, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ definitionRows: rows.length, books: books.length, classicBooks: retained.length, outsideBooks: outsideBooks.length,
  references: references.length, missingReferences: evidence.missingReferences.length, outsideBookReferences: evidence.outsideBookReferences.length,
  nativeFindings: native.findings.length, nativeWarnings: native.nativeLog.length, report: destination }, null, 2));
