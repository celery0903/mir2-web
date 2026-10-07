import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const execute = promisify(execFile);
const beforeOnly = process.argv.includes('--before-only');
const destination = resolve(process.env.MIR_DATA_CHANNEL_REPORT ?? '.runtime/reports/data-channel');
const work = await mkdtemp(resolve('.runtime/data-channel-checks-'));
await mkdir(destination, { recursive: true });
const scenarios = ['single', 'coalesced', 'split-header', 'split-body', 'trailing-partial',
  'large-fragmented', 'invalid-signature', 'independent-adapters'];
const report = { checkedAt: new Date().toISOString(), passed: false, full176Acceptance: false, beforeOnly,
  scope: 'Actual DataQueryServer DLL against a loopback TCP peer; native request framing, split/coalesced/large replies, signature rejection and per-connection packet isolation. Each case runs in a separate container.', results: {} };
try {
  const images = [['before', process.env.MIR_DATA_CHANNEL_BEFORE_IMAGE ?? 'mir2-web-engine:before-login-queue']];
  if (!beforeOnly) images.push(['after', process.env.MIR_DATA_CHANNEL_ENGINE_IMAGE ?? 'mir2-login-queue-engine:test']);
  for (const [label, image] of images) {
    const run = join(work, label); await mkdir(join(run, 'engine'), { recursive: true });
    const imageID = (await execute('docker', ['image', 'inspect', image, '--format', '{{.Id}}'])).stdout.trim();
    const container = (await execute('docker', ['create', imageID])).stdout.trim();
    try { await execute('docker', ['cp', `${container}:/engine/GameSrv`, join(run, 'engine/GameSrv')]); }
    finally { await execute('docker', ['rm', container]); }
    const checks = join(run, 'checks'); await mkdir(checks);
    for (const file of ['Program.cs', 'DataChannelChecks.csproj']) await copyFile(join('tests/data-channel', file), join(checks, file));
    const assemblyHashes = {};
    for (const file of ['GameSrv.dll', 'OpenMir2.dll']) assemblyHashes[file] = createHash('sha256')
      .update(await readFile(join(run, 'engine/GameSrv', file))).digest('hex');
    const result = report.results[label] = { image: imageID, assemblyHashes, cases: [] };
    const mounts = ['-v', `${run}/engine:/engine:ro`, '-v', `${checks}:/tests`];
    await execute('docker', ['run', '--rm', '--network', 'none', ...mounts, 'mcr.microsoft.com/dotnet/sdk:8.0',
      'dotnet', 'build', '/tests/DataChannelChecks.csproj', '-c', 'Release', '--nologo'], { timeout: 120000, maxBuffer: 1024 * 1024 });
    for (const scenario of scenarios) {
      const entry = { scenario };
      try {
        Object.assign(entry, await execute('docker', ['run', '--rm', '--network', 'none', '--ulimit', 'core=0',
          ...mounts, 'mcr.microsoft.com/dotnet/sdk:8.0', 'dotnet', '/tests/bin/Release/net8.0/DataChannelChecks.dll', scenario],
        { timeout: 20000, maxBuffer: 1024 * 1024 }), { exitCode: 0 });
      } catch (error) { Object.assign(entry, { exitCode: error.code, stdout: error.stdout, stderr: error.stderr }); }
      for (const [file, hash] of Object.entries(assemblyHashes)) assert.ok(entry.stdout?.includes(`Assembly ${file} SHA-256: ${hash}`));
      const native = JSON.parse(/^DATA_CHANNEL_RESULTS=(.+)$/m.exec(entry.stdout)?.[1] ?? 'null');
      if (native) { assert.equal(native.length, 1); assert.equal(native[0].scenario, scenario); entry.native = native[0]; }
      entry.passed = entry.exitCode === 0 && entry.native?.passed === true;
      result.cases.push(entry);
      console.log(`${label}: ${scenario}: ${entry.passed ? 'passed' : `failed (${entry.exitCode})`}`);
      await writeFile(join(destination, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
    }
  }
  report.reproduced = report.results.before.cases.some(test => !test.passed);
  assert.equal(report.reproduced, true);
  if (!beforeOnly) {
    assert.ok(report.results.after.cases.every(test => test.passed));
    report.passed = true;
  }
} catch (error) { report.error = String(error); throw error; }
finally { await writeFile(join(destination, 'evidence.json'), JSON.stringify(report, null, 2) + '\n'); }
