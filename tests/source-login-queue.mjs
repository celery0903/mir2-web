import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const execute = promisify(execFile);
const beforeOnly = process.argv.includes('--before-only');
const destination = resolve(process.env.MIR_LOGIN_QUEUE_REPORT ?? '.runtime/reports/login-queue');
const work = await mkdtemp(resolve('.runtime/login-queue-checks-'));
await mkdir(destination, { recursive: true });
const report = { passed: false, full176Acceptance: false, beforeOnly,
  scope: 'Actual WorldServer.ProcessHumans DLL method; unfinished requests and all positions of processed requests. Empty backend/network stubs, no database.', results: {} };
try {
  const images = [['before', process.env.MIR_LOGIN_QUEUE_BEFORE_IMAGE ?? 'mir2-web-engine:before-login-queue']];
  if (!beforeOnly) images.push(['after', process.env.MIR_LOGIN_QUEUE_ENGINE_IMAGE ?? 'mir2-login-queue-engine:test']);
  for (const [label, image] of images) {
    const run = join(work, label); await mkdir(join(run, 'engine'), { recursive: true });
    const imageID = (await execute('docker', ['image', 'inspect', image, '--format', '{{.Id}}'])).stdout.trim();
    const container = (await execute('docker', ['create', imageID])).stdout.trim();
    try { await execute('docker', ['cp', `${container}:/engine/GameSrv`, join(run, 'engine/GameSrv')]); }
    finally { await execute('docker', ['rm', container]); }
    const checks = join(run, 'checks'); await mkdir(checks);
    for (const file of ['Program.cs', 'LoginQueueChecks.csproj']) await copyFile(join('tests/login-queue', file), join(checks, file));
    const assemblyHashes = {};
    for (const file of ['GameSrv.dll', 'M2Server.dll']) assemblyHashes[file] = createHash('sha256')
      .update(await readFile(join(run, 'engine/GameSrv', file))).digest('hex');
    const result = { image: imageID, assemblyHashes };
    try {
      Object.assign(result, await execute('docker', ['run', '--rm', '--network', 'none', '-v', `${run}/engine:/engine:ro`,
        '-v', `${checks}:/tests`, 'mcr.microsoft.com/dotnet/sdk:8.0', 'dotnet', 'run', '--project', '/tests/LoginQueueChecks.csproj', '-c', 'Release'],
      { timeout: 120000, maxBuffer: 1024 * 1024 }), { exitCode: 0 });
    } catch (error) { Object.assign(result, { exitCode: error.code, stdout: error.stdout, stderr: error.stderr }); }
    report.results[label] = result;
    for (const [file, hash] of Object.entries(assemblyHashes)) assert.ok(result.stdout?.includes(`Assembly ${file} SHA-256: ${hash}`));
    result.cases = JSON.parse(/^LOGIN_QUEUE_RESULTS=(.+)$/m.exec(result.stdout)?.[1] ?? 'null');
    assert.ok(Array.isArray(result.cases));
    console.log(`${label}: ${result.stdout.trim().split('\n').at(-1)}`);
  }
  report.reproduced = report.results.before.cases.some(test => test.label === 'finished indices 1' && !test.passed);
  assert.equal(report.reproduced, true);
  if (!beforeOnly) {
    assert.equal(report.results.after.exitCode, 0);
    assert.ok(report.results.after.cases.every(test => test.passed));
    report.passed = true;
  }
} catch (error) { report.error = String(error); throw error; }
finally { await writeFile(join(destination, 'evidence.json'), JSON.stringify(report, null, 2) + '\n'); }
