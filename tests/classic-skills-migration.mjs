import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { loadClassicSkills, classifySkills, classicSkillsSql } from '../scripts/classic-skills.mjs';

const execute = promisify(execFile);
const destination = resolve(process.env.MIR_SKILL_SQL_REPORT ?? '.runtime/reports/classic-skills-sql');
const name = `mir2-classic-skills-test-${Date.now()}`;
const policy = await loadClassicSkills(), migration = classicSkillsSql(policy);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const seed = `USE mir2_data;\n${await readFile('upstream/openmir2/sql/mir2_data.sql', 'utf8')}`;
const report = { checkedAt: new Date().toISOString(), passed: false, full176Acceptance: false,
  scope: 'Real MySQL with pinned native schemas; exact skill-row and saved-reference preservation, transactional rejection and fresh initialization.',
  policySha256: digest(await readFile('shared/classic-skills.json')), migrationSha256: digest(migration), cases: [] };
await mkdir(destination, { recursive: true });

function sql(query) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', name, 'sh', '-c',
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --default-character-set=utf8mb4 -uroot --batch --raw --skip-column-names']);
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(Object.assign(new Error(stderr), { code, stdout, stderr })));
    child.stdin.on('error', reject); child.stdin.end(query);
  });
}
async function rows(table) {
  const columns = (await sql(`SHOW COLUMNS FROM mir2_data.${table}`)).trim().split('\n').map(line => line.split('\t')[0]);
  const object = columns.map(column => `'${column}',\`${column}\``).join(',');
  const result = await sql(`SELECT JSON_OBJECT(${object}) FROM mir2_data.${table} ORDER BY \`${columns[0]}\``);
  return result.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}
const savedTables = ['characters_item', 'characters_bagitem', 'characters_storageitem', 'characters_item_attr', 'characters_magic'];
async function snapshot() {
  const skills = await rows('magics'), items = await rows('stditems');
  const saved = await sql(savedTables.map(table => `SELECT '${table}'; SELECT * FROM mir2_db.${table} ORDER BY Id;`).join('\n'));
  return { skills, itemRows: items.length, itemsSha256: digest(JSON.stringify(items)), savedSha256: digest(saved) };
}
async function runCase(label, callback) {
  try { await callback(); report.cases.push({ label, passed: true }); console.log(`PASS ${label}`); }
  catch (error) { report.cases.push({ label, passed: false, error: String(error) }); throw error; }
}
async function reset() {
  await sql(seed);
  await sql(savedTables.map(table => `DELETE FROM mir2_db.${table};`).join('\n'));
  await sql(`INSERT INTO mir2_db.characters_magic (PlayerId,MagicId,Level,UseKey,CurrTrain) VALUES (101,1,2,'1',123),(102,3,3,'2',0),(103,31,0,'3',77);
INSERT INTO mir2_db.characters_item (PlayerId,Position,MakeIndex,StdIndex,Dura,DuraMax) VALUES (101,1,314159,207,3978,4000);
INSERT INTO mir2_db.characters_bagitem (PlayerId,Position,MakeIndex,StdIndex,Dura,DuraMax) VALUES (101,2,271828,97,1,1);
INSERT INTO mir2_db.characters_storageitem (PlayerId,MakeIndex,StdIndex,Dura,DuraMax) VALUES (101,161803,98,1,1);`);
}
async function rejectsWithoutChanges(mutate) {
  await reset(); await sql(mutate);
  const before = await snapshot();
  await assert.rejects(sql(migration), /check constraint.*violated/i);
  assert.deepEqual(await snapshot(), before, 'Rejected migration must leave every checked row unchanged');
}
let created = false;
try {
  await execute(process.execPath, ['scripts/prepare-openmir2.mjs']);
  report.initSqlSha256 = digest(await readFile('.runtime/openmir2/sql/03-classic-skills.sql'));
  assert.equal(report.initSqlSha256, report.migrationSha256);
  report.mysqlImage = (await execute('docker', ['inspect', 'mir2-web-db-1', '--format', '{{.Image}}'])).stdout.trim();
  await execute('docker', ['run', '-d', '--name', name, '--network', 'none',
    '-e', `MYSQL_ROOT_PASSWORD=${randomBytes(24).toString('hex')}`,
    '-v', `${resolve('.runtime/openmir2/sql')}:/docker-entrypoint-initdb.d:ro`, report.mysqlImage]);
  created = true;
  const deadline = Date.now() + 120000;
  while (true) {
    try {
      const ready = await sql("SELECT COUNT(*) FROM mir2_data.magics; SHOW GLOBAL VARIABLES LIKE 'port';");
      const logs = await execute('docker', ['logs', name]);
      if (ready.startsWith('33\n') && logs.stdout.includes('MySQL init process done. Ready for start up.')) break;
    } catch { /* Wait for all entrypoint scripts and the final server. */ }
    assert.ok(Date.now() < deadline, 'Fresh database initialization timed out');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  await runCase('fresh initialization loads exactly 33 identities and no upstream characters', async () => {
    const state = await snapshot();
    assert.equal(classifySkills(state.skills, policy).removed.length, 0);
    assert.equal(state.itemRows, 1000);
    assert.equal((await sql('SELECT COUNT(*) FROM mir2_db.characters; SELECT COUNT(*) FROM mir2_db.characters_magic;')).trim(), '0\n0');
    const freshSkills = state.skills;
    await sql(seed);
    assert.deepEqual(freshSkills, classifySkills(await rows('magics'), policy).retained);
  });
  await runCase('all retained numerical rows, item indices and learned/equipped/bag/warehouse records survive', async () => {
    await reset(); const before = await snapshot(), expected = classifySkills(before.skills, policy).retained;
    assert.equal(before.skills.length, 108);
    await sql(migration);
    const after = await snapshot();
    assert.deepEqual(after.skills, expected);
    assert.equal(after.itemsSha256, before.itemsSha256); assert.equal(after.savedSha256, before.savedSha256);
    assert.equal(after.itemRows, 1000);
    report.retention = { beforeSkills: before.skills.length, afterSkills: after.skills.length,
      retainedRowsSha256: digest(JSON.stringify(expected)), itemDefinitionsSha256: after.itemsSha256, savedReferencesSha256: after.savedSha256 };
  });
  await runCase('second migration is idempotent', async () => {
    const before = await snapshot(); await sql(migration); assert.deepEqual(await snapshot(), before);
  });
  await runCase('missing classic identity rejects atomically', () => rejectsWithoutChanges('DELETE FROM mir2_data.magics WHERE MagID=33;'));
  await runCase('wrong classic name rejects atomically', () => rejectsWithoutChanges("UPDATE mir2_data.magics SET MagName='后期技能' WHERE MagID=1;"));
  await runCase('wrong classic job rejects atomically', () => rejectsWithoutChanges('UPDATE mir2_data.magics SET Job=2 WHERE MagID=1;'));
  const columns = (await sql('SHOW COLUMNS FROM mir2_data.magics')).trim().split('\n').map(line => line.split('\t')[0]).filter(column => column !== 'Idx').map(column => `\`${column}\``).join(',');
  await runCase('duplicate classic identity rejects atomically', () => rejectsWithoutChanges(`INSERT INTO mir2_data.magics (${columns}) SELECT ${columns} FROM mir2_data.magics WHERE MagID=1;`));
  await runCase('conflicting row with a classic ID rejects atomically', () => rejectsWithoutChanges("INSERT INTO mir2_data.magics (MagID,MagName,Job) VALUES (1,'后期技能',1);"));
  await runCase('nonclassic learned skill rejects without deleting the saved skill', () => rejectsWithoutChanges("INSERT INTO mir2_db.characters_magic (PlayerId,MagicId,Level,UseKey,CurrTrain) VALUES (104,48,1,'4',42);"));
  await runCase('nullable outside identities are removed and retained rows stay intact', async () => {
    await reset(); const before = await snapshot();
    await sql("INSERT INTO mir2_data.magics (MagID,MagName,Job) VALUES (NULL,NULL,NULL),(99,NULL,1),(99,'火球术',NULL);");
    await sql(migration);
    const after = await snapshot();
    assert.deepEqual(after.skills, classifySkills(before.skills, policy).retained);
    assert.equal(after.itemsSha256, before.itemsSha256); assert.equal(after.savedSha256, before.savedSha256);
  });
  await runCase('nontransactional skill table rejects before any deletion', () => rejectsWithoutChanges('ALTER TABLE mir2_data.magics ENGINE=MyISAM;'));
  report.passed = true;
} catch (error) {
  report.error = String(error); throw error;
} finally {
  if (created) {
    const logs = await execute('docker', ['logs', name]);
    await writeFile(join(destination, 'mysql.log'), logs.stdout + logs.stderr);
    await execute('docker', ['rm', '-f', '-v', name]);
  }
  await writeFile(join(destination, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(`Classic skill SQL: ${report.cases.length} cases passed. Report: ${destination}`);
