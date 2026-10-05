import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadClassicSkills, classifySkills, classicSkillsSql } from './classic-skills.mjs';

const execute = promisify(execFile);
const args = process.argv.slice(2);
assert.ok(args.length <= 1 && args.every(arg => arg === '--apply'), 'Expected optional --apply');
const apply = args.includes('--apply');
const project = process.env.MIR_PROJECT ?? 'mir2-web';
assert.ok(['mir2-web', 'mir2-rebuild'].includes(project), 'Requires the declared production or isolated project');
const destination = process.env.MIR_SKILL_MIGRATION_REPORT ?? `.runtime/reports/classic-skill-migration-${project}-${Date.now()}`;
const database = `${project}-db-1`, engine = `${project}-engine-1`;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const policy = await loadClassicSkills();
const inspect = async () => JSON.parse((await execute('docker', ['inspect', engine, database])).stdout).map(container => ({
  name: container.Name, id: container.Id, image: container.Image, startedAt: container.State.StartedAt,
  health: container.State.Health.Status, mounts: container.Mounts.filter(mount => mount.Type === 'volume')
    .map(({ Name, Destination }) => ({ Name, Destination }))
}));
const sql = async query => (await execute('docker', ['exec', database, 'sh', '-c',
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --default-character-set=utf8mb4 -uroot --batch --raw --skip-column-names -e "$1"', 'sh', query],
  { maxBuffer: 16 * 1024 * 1024 })).stdout;
async function rows(table) {
  const columns = (await sql(`SHOW COLUMNS FROM mir2_data.${table}`)).trim().split('\n').map(line => line.split('\t')[0]);
  for (const column of columns) assert.match(column, /^[A-Za-z0-9_]+$/);
  const object = columns.map(column => `'${column}',\`${column}\``).join(',');
  const result = await sql(`SELECT JSON_OBJECT(${object}) FROM mir2_data.${table} ORDER BY \`${columns[0]}\``);
  return result.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}
async function snapshot() {
  const skills = await rows('magics');
  const items = await rows('stditems');
  const learned = (await sql('SELECT MagicId,COUNT(*) FROM mir2_db.characters_magic GROUP BY MagicId ORDER BY MagicId'))
    .trim().split('\n').filter(Boolean).map(line => { const [magicId, count] = line.split('\t'); return { magicId: Number(magicId), count: Number(count) }; });
  const savedItems = await sql(['characters_item', 'characters_bagitem', 'characters_storageitem', 'characters_item_attr', 'characters_magic']
    .map(table => `SELECT * FROM mir2_db.${table} ORDER BY Id;`).join('\n'));
  return { skills, itemsSha256: digest(JSON.stringify(items)), itemRows: items.length,
    learned, savedItemsAndSkillsSha256: digest(savedItems), ...classifySkills(skills, policy) };
}
await mkdir(destination, { recursive: true });
const report = { checkedAt: new Date().toISOString(), project, apply, passed: false, full176Acceptance: false,
  authenticated2003Data: false, policySha256: digest(await readFile('shared/classic-skills.json')), policy,
  scope: 'Remove skills outside the exact classic identity list. Retained numerical rows, item indices and character skill/item records are preserved.' };
let stopped = false;
try {
  report.before = await snapshot();
  report.unsupportedLearnedSkills = report.before.learned.filter(skill => !policy.skills.some(value => value.magicId === skill.magicId));
  assert.deepEqual(report.unsupportedLearnedSkills, [], 'A character owns a skill outside the classic scope; explicit migration is required');
  if (apply) {
    assert.equal(process.env.MIR_APPLY_CLASSIC_SKILLS, '1', 'Applying the migration requires explicit opt-in');
    report.containersBefore = await inspect();
    assert.ok(report.containersBefore.every(container => container.health === 'healthy'));
    const stoppedAt = new Date().toISOString();
    stopped = true;
    await execute('docker', ['stop', '--time', '45', engine], { timeout: 65000 });
    const logs = await execute('docker', ['logs', '--since', stoppedAt, engine]);
    await writeFile(join(destination, 'shutdown.log'), logs.stdout + logs.stderr);
    report.shutdown = { nativeSaveAcknowledged: logs.stdout.includes('OPENMIR2_SAVE_COMPLETE'), nativeExit: logs.stdout.includes('OPENMIR2_GAME_EXIT=0') };
    assert.ok(report.shutdown.nativeSaveAcknowledged && report.shutdown.nativeExit);
    report.afterNativeSave = await snapshot();
    assert.deepEqual(report.afterNativeSave.skills, report.before.skills, 'Skill table changed during native save');
    const dump = await execute('docker', ['exec', database, 'sh', '-c',
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump --default-character-set=utf8mb4 -uroot --single-transaction --no-tablespaces mir2_data magics'], { maxBuffer: 16 * 1024 * 1024 });
    const backup = join(destination, 'magics-before.sql');
    await writeFile(backup, dump.stdout, { mode: 0o600 });
    report.backup = { path: backup, sha256: digest(dump.stdout) };
    const migration = classicSkillsSql(policy);
    await writeFile(join(destination, 'migration.sql'), migration);
    await sql(migration);
    report.after = await snapshot();
    assert.deepEqual(report.after.skills, report.afterNativeSave.retained, 'A retained skill row changed');
    assert.equal(report.after.removed.length, 0);
    assert.equal(report.after.itemRows, report.afterNativeSave.itemRows);
    assert.equal(report.after.itemsSha256, report.afterNativeSave.itemsSha256, 'Item definitions or list indices changed');
    assert.equal(report.after.savedItemsAndSkillsSha256, report.afterNativeSave.savedItemsAndSkillsSha256, 'Saved item or skill records changed');
    report.numericalRowsPreserved = true;
    report.itemDefinitionsAndSavedReferencesPreserved = true;
    await execute('docker', ['start', engine]);
    stopped = false;
    const deadline = Date.now() + 90000;
    do {
      report.containersAfter = await inspect();
      if (report.containersAfter.every(container => container.health === 'healthy')) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    } while (Date.now() < deadline);
    assert.ok(report.containersAfter.every(container => container.health === 'healthy'));
    for (const before of report.containersBefore) {
      const after = report.containersAfter.find(container => container.name === before.name);
      assert.equal(after.id, before.id);
      assert.equal(after.image, before.image);
      assert.deepEqual(after.mounts, before.mounts);
      if (before.name === `/${database}`) assert.equal(after.startedAt, before.startedAt);
    }
    const restartedAt = report.containersAfter.find(container => container.name === `/${engine}`).startedAt;
    const startup = await execute('docker', ['logs', '--since', restartedAt, engine]);
    await writeFile(join(destination, 'startup.log'), startup.stdout + startup.stderr);
    report.nativeLoadedSkills = startup.stdout.includes(`加载技能数据库成功...[${policy.skills.length}]`);
    assert.ok(report.nativeLoadedSkills, 'Native engine did not acknowledge loading the classic skill count');
  }
  report.passed = true;
  console.log(`${apply ? 'APPLIED' : 'PLAN'} ${report.before.retained.length} classic skills; ${report.before.removed.length} outside the classic scope; ${report.before.itemRows} item rows preserved. Report: ${destination}`);
} catch (error) {
  report.error = String(error);
  throw error;
} finally {
  try {
    if (stopped) {
      await execute('docker', ['start', engine]);
      report.recoveryRestartedEngine = true;
    }
  } catch (error) {
    report.recoveryError = String(error);
    throw error;
  } finally {
    await writeFile(join(destination, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
  }
}
