import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, copyFile, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const execute = promisify(execFile);
const destination = resolve(process.env.MIR_ITEMS_REPORT ?? '.runtime/reports/source-items');
await mkdir(destination, { recursive: true });
const work = await mkdtemp(resolve('.runtime/item-checks-'));
const password = randomBytes(24).toString('hex');
const name = `mir2-native-items-${Date.now()}`, network = `${name}-net`;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const beforeOnly = process.argv.includes('--before-only');
const report = { checkedAt: new Date().toISOString(), passed: false, full176Acceptance: false,
  scope: 'Real native DLLs and isolated MySQL; sparse, reordered and invalid SQL item IDs, retained fields and saved instance references.',
  results: {} };
function sql(query) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', name, 'sh', '-c',
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --default-character-set=utf8mb4 -uroot --batch --raw --skip-column-names']);
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
    child.stdin.on('error', reject); child.stdin.end(query);
  });
}
let created = false, networkCreated = false;
try {
  report.mysqlImage = (await execute('docker', ['inspect', 'mir2-web-db-1', '--format', '{{.Image}}'])).stdout.trim();
  await execute('docker', ['network', 'create', '--internal', network]); networkCreated = true;
  const envFile = join(work, 'database.env');
  await writeFile(envFile, `MYSQL_ROOT_PASSWORD=${password}\nMYSQL_ROOT_HOST=%\n`, { mode: 0o600 });
  await execute('docker', ['run', '-d', '--name', name, '--network', network, '--env-file', envFile, report.mysqlImage]);
  created = true;
  const deadline = Date.now() + 120000;
  while (true) {
    try {
      await sql('SELECT 1');
      const logs = await execute('docker', ['logs', name]);
      if (logs.stdout.includes('MySQL init process done. Ready for start up.')) break;
    } catch { /* Wait for the final server after entrypoint initialization. */ }
    assert.ok(Date.now() < deadline, 'Isolated database initialization timed out');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const images = [['before', process.env.MIR_ITEMS_BEFORE_IMAGE ?? 'sha256:e2f6a9c5fc81e10ac1eff309f7701f16bbaf90f7edf87c4bb8a74eed6297548a']];
  if (!beforeOnly) images.push(['after', process.env.MIR_ITEMS_ENGINE_IMAGE ?? 'mir2-items-engine:test']);
  for (const [label, image] of images) {
    await sql('DROP DATABASE IF EXISTS mir2_data; DROP DATABASE IF EXISTS mir2_db; CREATE DATABASE mir2_data; CREATE DATABASE mir2_db;');
    for (const [schema, file] of [['mir2_data', 'upstream/openmir2/sql/mir2_data.sql'], ['mir2_db', '.runtime/openmir2/sql/01-mir2_db.sql']]) {
      const bytes = await readFile(file);
      report[`${schema}SchemaSha256`] = digest(bytes);
      await sql(`USE ${schema};\n${bytes.toString('utf8')}`);
    }
    const run = join(work, label); await mkdir(run);
    const imageID = (await execute('docker', ['image', 'inspect', image, '--format', '{{.Id}}'])).stdout.trim();
    const container = (await execute('docker', ['create', imageID])).stdout.trim();
    try { await execute('docker', ['cp', `${container}:/engine`, run]); }
    finally { await execute('docker', ['rm', container]); }
    const checks = join(run, 'checks'); await mkdir(checks);
    for (const file of ['Program.cs', 'ItemChecks.csproj']) await copyFile(join('tests/items', file), join(checks, file));
    const assemblyHashes = {};
    for (const file of ['GameSrv.dll', 'M2Server.dll', 'OpenMir2.dll', 'SystemModule.dll'])
      assemblyHashes[file] = digest(await readFile(join(run, 'engine/GameSrv', file)));
    const result = { image: imageID, assemblyHashes };
    const connectionFile = join(run, 'connection.env');
    await writeFile(connectionFile, `MIR_ITEM_CHECK_CONNECTION=Server=${name};Database=mir2_data;User ID=root;Password=${password};SslMode=None;AllowPublicKeyRetrieval=True\n`, { mode: 0o600 });
    try {
      Object.assign(result, await execute('docker', ['run', '--rm', '--network', network, '--env-file', connectionFile,
        '-v', `${run}/engine:/engine:ro`, '-v', `${checks}:/tests`, 'mcr.microsoft.com/dotnet/sdk:8.0',
        'dotnet', 'run', '--project', '/tests/ItemChecks.csproj', '-c', 'Release', '--nologo'],
      { timeout: 120000, maxBuffer: 1024 * 1024 }), { exitCode: 0 });
    } catch (error) { Object.assign(result, { exitCode: error.code, stdout: error.stdout, stderr: error.stderr }); }
    report.results[label] = result;
    for (const [file, hash] of Object.entries(assemblyHashes))
      assert.ok(result.stdout?.includes(`Assembly ${file} SHA-256: ${hash}`), `Loaded ${file} differs from declared image`);
    result.cases = JSON.parse(/^ITEM_CHECK_RESULTS=(.+)$/m.exec(result.stdout)?.[1] ?? 'null');
    assert.ok(Array.isArray(result.cases), 'Native checks did not report their results');
    report.results[label] = result;
    console.log(`${label}: ${result.stdout.trim().split('\n').at(-1)}`);
  }
  report.reproduced = report.results.before.cases.some(test => test.label.startsWith('sparse rows') && !test.passed)
    && report.results.before.cases.some(test => test.label.startsWith('conversion failure') && !test.passed);
  assert.equal(report.reproduced, true, 'Old engine did not reproduce sparse ID and partial-success bugs');
  report.passed = !beforeOnly && report.results.after.exitCode === 0 && report.results.after.cases.every(test => test.passed);
  if (!beforeOnly) assert.equal(report.passed, true, 'Patched native item checks failed');
} catch (error) { report.error = String(error); throw error; }
finally {
  if (created) {
    const logs = await execute('docker', ['logs', name]);
    await writeFile(join(destination, 'mysql.log'), logs.stdout + logs.stderr);
    await execute('docker', ['rm', '-f', '-v', name]);
  }
  if (networkCreated) await execute('docker', ['network', 'rm', network]);
  await writeFile(join(destination, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ passed: report.passed, reproduced: report.reproduced, full176Acceptance: false, report: destination }, null, 2));
