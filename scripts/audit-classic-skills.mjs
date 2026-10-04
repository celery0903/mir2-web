import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const execute = promisify(execFile);
const project = process.argv[2] ?? 'mir2-web';
assert.match(project, /^[a-z0-9][a-z0-9_-]*$/);
const destination = process.argv[3] ?? 'docs/classic-skill-data-audit.json';
const candidate = JSON.parse(await readFile('docs/reference-176-audit.json'));
const candidateFile = `.runtime/mirserver-1.76-${candidate.revision}/mud2/db/Magic.DB`;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(digest(await readFile(candidateFile)), candidate.sourceFiles['Magic.DB'].sha256, 'Reference skill table was modified');
const columns = ['Idx', 'MagID', 'MagName', 'EffectType', 'Effect', 'Spell', 'Power', 'MaxPower', 'DefSpell', 'DefPower', 'DefMaxPower', 'Job', 'NeedL1', 'L1Train', 'NeedL2', 'L2Train', 'NeedL3', 'L3Train', 'Delay'];
const object = names => `JSON_OBJECT(${names.map(name => `'${name}',${name}`).join(',')})`;
const sql = `SELECT JSON_OBJECT('skills',(SELECT JSON_ARRAYAGG(${object(columns)}) FROM magics),'books',(SELECT JSON_ARRAYAGG(${object(['Id', 'Name', 'StdMode', 'Shape', 'ImgIndex', 'NeedLevel'])}) FROM stditems WHERE StdMode=4))`;
const { stdout } = await execute('docker', ['exec', `${project}-db-1`, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --default-character-set=utf8mb4 -uroot -NBr mir2_data -e "$1"', 'sh', sql]);
const data = JSON.parse(stdout);
const canonical = candidate.first33Skills;
assert.equal(canonical.length, 33);
const comparisons = canonical.map(reference => {
  const rows = data.skills.filter(row => row.MagID === reference.MagID);
  const identityMatches = rows.length === 1 && rows[0].MagName === reference.MagName && rows[0].Job === reference.Job;
  const differences = columns.filter(field => !['Idx', 'MagID', 'MagName'].includes(field) && rows[0]?.[field] !== reference[field])
    .map(field => ({ field, running: rows[0]?.[field] ?? null, candidate: reference[field] }));
  return { magicId: reference.MagID, name: reference.MagName, job: reference.Job, identityMatches,
    running: rows, candidate: Object.fromEntries(columns.filter(field => field !== 'Idx').map(field => [field, reference[field]])),
    differences, books: data.books.filter(book => book.Name === reference.MagName), numericalAcceptance: 'unverified' };
});
const { stdout: revision } = await execute('git', ['-C', 'upstream/openmir2', 'rev-parse', 'HEAD']);
const identities = new Set(canonical.map(row => `${row.MagID}:${row.MagName}:${row.Job}`));
const names = new Set(canonical.map(row => row.MagName));
const report = { checkedAt: new Date().toISOString(), project, readOnly: true, full176Acceptance: false, authenticated2003Data: false,
  sources: {
    running: { repository: 'mirbeta/OpenMir2', revision: revision.trim(), sqlSha256: digest(await readFile('upstream/openmir2/sql/mir2_data.sql')) },
    candidate: { repository: candidate.repository, revision: candidate.revision, file: 'mud2/db/Magic.DB', ...candidate.sourceFiles['Magic.DB'], directImportAccepted: false },
    bookLearning: { file: 'upstream/openmir2/src/M2Server/Player/PlayObject.Base.cs', sha256: digest(await readFile('upstream/openmir2/src/M2Server/Player/PlayObject.Base.cs')), method: 'ReadBook', mapping: 'Book name to magic name; magic job and TrainLevel[0] gate learning. Item Shape and NeedLevel do not select the magic.' }
  },
  skillRows: data.skills.length, bookRows: data.books.length, agreeingIdentities: comparisons.filter(row => row.identityMatches).length,
  skillsWithNumericalDifferences: comparisons.filter(row => row.differences.length).length,
  outsideCanonicalSkills: data.skills.filter(row => !identities.has(`${row.MagID}:${row.MagName}:${row.Job}`)),
  outsideCanonicalBooks: data.books.filter(row => !names.has(row.Name)), comparisons,
  dataLayoutRisk: 'Native items are addressed by a one-based list position. Deleting noncontiguous stditems rows shifts saved item references; a version migration must preserve or explicitly migrate item indices.',
  interpretation: 'Agreement between two community tables identifies candidates, not official 2003 values. The running uniform training thresholds, the alternative training thresholds and other numerical differences require historical evidence. This audit does not filter or authenticate production data.' };
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
console.log(`Classic identities: ${report.agreeingIdentities}/33; numerical differences: ${report.skillsWithNumericalDifferences}/33; ${report.outsideCanonicalSkills.length} other skills and ${report.outsideCanonicalBooks.length} other books remain. No database changes.`);
