import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const execute = promisify(execFile);
const beforeOnly = process.argv.includes('--before-only');
const destination = resolve(process.env.MIR_LOGIN_RECONNECT_REPORT ?? '.runtime/reports/login-reconnect');
const work = await mkdtemp(resolve('.runtime/login-reconnect-checks-'));
await mkdir(destination, { recursive: true });
const scenarios = ['initial-session', 'remote-close', 'split-reset', 'explicit-close', 'interleaved-fragments'];
const report = { checkedAt: new Date().toISOString(), passed: false, full176Acceptance: false, beforeOnly,
  scope: 'Actual authentication and login-server parser DLLs; isolated loopback TCP, repeated passive disconnects, fresh authorization, partial frame reset, intentional close and independent connection buffers. No game database.', results: {} };
try {
  const images = [['before', process.env.MIR_LOGIN_RECONNECT_BEFORE_IMAGE ?? 'sha256:6ac84b5d5365c4f13be863918fc793dd527f948f7e3a1650abc0d0100c5cfd1a']];
  if (!beforeOnly) images.push(['after', process.env.MIR_LOGIN_RECONNECT_ENGINE_IMAGE ?? 'mir2-login-reconnect-engine:test']);
  for (const [label, image] of images) {
    const run = join(work, label); await mkdir(join(run, 'engine'), { recursive: true });
    const imageID = (await execute('docker', ['image', 'inspect', image, '--format', '{{.Id}}'])).stdout.trim();
    const container = (await execute('docker', ['create', imageID])).stdout.trim();
    try {
      for (const service of ['GameSrv', 'LoginSrv'])
        await execute('docker', ['cp', `${container}:/engine/${service}`, join(run, 'engine', service)]);
    } finally { await execute('docker', ['rm', container]); }
    const checks = join(run, 'checks'); await mkdir(checks);
    for (const file of ['Program.cs', 'LoginReconnectChecks.csproj'])
      await copyFile(join('tests/login-reconnect', file), join(checks, file));
    const assemblyHashes = {};
    for (const file of ['GameSrv', 'LoginSrv']) assemblyHashes[`${file}.dll`] = createHash('sha256')
      .update(await readFile(join(run, 'engine', file, `${file}.dll`))).digest('hex');
    const result = report.results[label] = { image: imageID, assemblyHashes, cases: [] };
    const mounts = ['-v', `${run}/engine:/engine:ro`, '-v', `${checks}:/tests`];
    await execute('docker', ['run', '--rm', '--network', 'none', ...mounts, 'mcr.microsoft.com/dotnet/sdk:8.0',
      'dotnet', 'build', '/tests/LoginReconnectChecks.csproj', '-c', 'Release', '--nologo'], { timeout: 120000 });
    for (const scenario of scenarios) {
      const entry = { scenario };
      try {
        Object.assign(entry, await execute('docker', ['run', '--rm', '--network', 'none', '--ulimit', 'core=0',
          ...mounts, 'mcr.microsoft.com/dotnet/sdk:8.0', 'dotnet', '/tests/bin/Release/net8.0/LoginReconnectChecks.dll', scenario],
        { timeout: 25000, maxBuffer: 1024 * 1024 }), { exitCode: 0 });
      } catch (error) { Object.assign(entry, { exitCode: error.code, stdout: error.stdout, stderr: error.stderr }); }
      for (const [file, hash] of Object.entries(assemblyHashes)) assert.ok(entry.stdout?.includes(`Assembly ${file} SHA-256: ${hash}`));
      const native = JSON.parse(/^LOGIN_RECONNECT_RESULTS=(.+)$/m.exec(entry.stdout)?.[1] ?? 'null');
      assert.ok(native && native.length === 1 && native[0].scenario === scenario);
      entry.native = native[0];
      entry.passed = entry.exitCode === 0 && entry.native.passed === true;
      result.cases.push(entry);
      console.log(`${label}: ${scenario}: ${entry.passed ? 'passed' : `failed (${entry.exitCode})`}`);
      await writeFile(join(destination, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
    }
  }
  report.reproduced = ['remote-close', 'interleaved-fragments'].every(scenario =>
    report.results.before.cases.some(test => test.scenario === scenario && !test.passed));
  assert.equal(report.reproduced, true);
  if (!beforeOnly) {
    assert.ok(report.results.after.cases.every(test => test.passed));
    report.passed = true;
  }
} catch (error) { report.error = String(error); throw error; }
finally { await writeFile(join(destination, 'evidence.json'), JSON.stringify(report, null, 2) + '\n'); }
