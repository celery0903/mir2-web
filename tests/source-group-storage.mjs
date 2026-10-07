import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const execute = promisify(execFile);
const destination = resolve(process.env.MIR_GROUP_STORAGE_REPORT ?? '.runtime/reports/group-storage');
const work = await mkdtemp(resolve('.runtime/group-storage-checks-'));
const name = `mir2-group-storage-${Date.now()}`, network = `${name}-net`;
const password = randomBytes(24).toString('hex');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { checkedAt: new Date().toISOString(), passed: false, full176Acceptance: false,
  scope: 'Actual native storage image DLLs and isolated MySQL; independent group/recall flags on creation, save and native reload.', results: {} };
await mkdir(destination, { recursive: true });
let created = false, networkCreated = false;
function sql(query) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', name, 'sh', '-c',
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --default-character-set=utf8mb4 -uroot --batch --skip-column-names']);
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
    child.stdin.on('error', reject); child.stdin.end(query);
  });
}
try {
  report.mysqlImage = (await execute('docker', ['inspect', 'mir2-web-db-1', '--format', '{{.Image}}'])).stdout.trim();
  await execute('docker', ['network', 'create', '--internal', network]); networkCreated = true;
  const envFile = join(work, 'database.env');
  await writeFile(envFile, `MYSQL_ROOT_PASSWORD=${password}\nMYSQL_ROOT_HOST=%\n`, { mode: 0o600 });
  await execute('docker', ['run', '-d', '--name', name, '--network', network, '--env-file', envFile,
    '--tmpfs', '/var/lib/mysql:rw,size=768m', report.mysqlImage]); created = true;
  const deadline = Date.now() + 120000;
  while (true) {
    try {
      await sql('SELECT 1');
      if ((await execute('docker', ['logs', name])).stdout.includes('MySQL init process done. Ready for start up.')) break;
    } catch { /* Wait for the final MySQL server. */ }
    assert.ok(Date.now() < deadline, 'Isolated database initialization timed out');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const schema = await readFile('.runtime/openmir2/sql/01-mir2_db.sql');
  assert.doesNotMatch(schema.toString(), /\bINSERT\s+INTO\b/i);
  report.schemaSha256 = digest(schema);
  for (const [label, image] of [
    ['before', process.env.MIR_GROUP_STORAGE_BEFORE_IMAGE ?? 'mir2-web-engine:before-group-storage'],
    ['after', process.env.MIR_GROUP_STORAGE_ENGINE_IMAGE ?? 'mir2-group-engine:test']
  ]) {
    await sql('DROP DATABASE IF EXISTS mir2_db; CREATE DATABASE mir2_db; USE mir2_db;\n' + schema.toString());
    const run = join(work, label); await mkdir(run);
    const imageID = (await execute('docker', ['image', 'inspect', image, '--format', '{{.Id}}'])).stdout.trim();
    const container = (await execute('docker', ['create', imageID])).stdout.trim();
    try { await execute('docker', ['cp', `${container}:/engine/DBSvr.Storage.MySQL`, join(run, 'storage')]); }
    finally { await execute('docker', ['rm', container]); }
    const checks = join(run, 'checks'); await mkdir(checks);
    for (const file of ['Program.cs', 'GroupStorageChecks.csproj']) await copyFile(join('tests/group-storage', file), join(checks, file));
    const assemblyHashes = {};
    for (const file of ['DBSrv.Storage.MySQL.dll', 'OpenMir2.dll']) assemblyHashes[file] = digest(await readFile(join(run, 'storage', file)));
    const result = { image: imageID, assemblyHashes };
    const connectionFile = join(run, 'connection.env');
    await writeFile(connectionFile, `MIR_GROUP_STORAGE_CONNECTION=Server=${name};Database=mir2_db;User ID=root;Password=${password};SslMode=None;AllowPublicKeyRetrieval=True\n`, { mode: 0o600 });
    try {
      Object.assign(result, await execute('docker', ['run', '--rm', '--network', network, '--env-file', connectionFile,
        '-v', `${run}/storage:/storage:ro`, '-v', `${checks}:/tests`, 'mcr.microsoft.com/dotnet/sdk:8.0',
        'dotnet', 'run', '--project', '/tests/GroupStorageChecks.csproj', '-c', 'Release'],
      { timeout: 120000, maxBuffer: 1024 * 1024 }), { exitCode: 0 });
    } catch (error) { Object.assign(result, { exitCode: error.code, stdout: error.stdout, stderr: error.stderr }); }
    report.results[label] = result;
    for (const [file, hash] of Object.entries(assemblyHashes)) assert.ok(result.stdout?.includes(`Assembly ${file} SHA-256: ${hash}`));
    result.cases = JSON.parse(/^GROUP_STORAGE_RESULTS=(.+)$/m.exec(result.stdout)?.[1] ?? 'null');
    assert.ok(Array.isArray(result.cases));
    console.log(`${label}: ${result.stdout.trim().split('\n').at(-1)}`);
  }
  assert.ok(report.results.before.cases.some(test => test.label === 'save group=1, recall=False' && !test.passed));
  assert.equal(report.results.after.exitCode, 0);
  assert.ok(report.results.after.cases.every(test => test.passed));
  report.passed = true;
} catch (error) { report.error = String(error); throw error; }
finally {
  if (created) await execute('docker', ['rm', '-f', name]);
  if (networkCreated) await execute('docker', ['network', 'rm', network]);
  await writeFile(join(destination, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
}
