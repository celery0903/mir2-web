import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const execute = promisify(execFile);
const destination = resolve(process.env.MIR_QUOTED_NAMES_REPORT ?? '.runtime/reports/quoted-names');
await mkdir(destination, { recursive: true });
const work = await mkdtemp(resolve('.runtime/quote-checks-'));
const report = { passed: false, full176Acceptance: false, scope: 'Actual native image DLLs; quoted item tokens and all GetValidStrCap overloads.', results: {} };
const before = process.env.MIR_QUOTED_NAMES_BEFORE_IMAGE ?? 'mir2-web-engine:before-quoted-names';
try {
  for (const [label, image] of [['before', before], ['after', process.env.MIR_QUOTED_NAMES_ENGINE_IMAGE ?? 'mir2-quoted-engine:test']]) {
    const run = join(work, label); await mkdir(run);
    const imageID = (await execute('docker', ['image', 'inspect', image, '--format', '{{.Id}}'])).stdout.trim();
    const container = (await execute('docker', ['create', imageID])).stdout.trim();
    try { await execute('docker', ['cp', `${container}:/engine`, run]); }
    finally { await execute('docker', ['rm', container]); }
    const checks = join(run, 'checks'); await mkdir(checks);
    for (const file of ['Program.cs', 'QuoteChecks.csproj']) await copyFile(join('tests/quoted-names', file), join(checks, file));
    const hash = createHash('sha256').update(await readFile(join(run, 'engine/GameSrv/OpenMir2.dll'))).digest('hex');
    const result = { image: imageID, openMir2Sha256: hash };
    try {
      Object.assign(result, await execute('docker', ['run', '--rm', '--network', 'none', '-v', `${run}/engine:/engine:ro`,
        '-v', `${checks}:/tests`, 'mcr.microsoft.com/dotnet/sdk:8.0', 'dotnet', 'run', '--project', '/tests/QuoteChecks.csproj', '-c', 'Release'],
        { timeout: 120000, maxBuffer: 1024 * 1024 }), { exitCode: 0 });
    } catch (error) { Object.assign(result, { exitCode: error.code, stdout: error.stdout, stderr: error.stderr }); }
    report.results[label] = result;
    assert.ok(result.stdout?.includes(`OpenMir2 assembly SHA-256: ${hash}`));
    result.cases = JSON.parse(/^QUOTE_CHECK_RESULTS=(.+)$/m.exec(result.stdout)?.[1] ?? 'null');
    assert.ok(Array.isArray(result.cases));
    console.log(`${label}: ${result.stdout.trim().split('\n').at(-1)}`);
  }
  report.reproduced = report.results.before.cases.some(test => test.label.startsWith('Chinese item name/') && !test.passed);
  assert.equal(report.reproduced, true);
  assert.equal(report.results.after.exitCode, 0);
  assert.ok(report.results.after.cases.every(test => test.passed));
  report.passed = true;
} catch (error) { report.error = String(error); throw error; }
finally { await writeFile(join(destination, 'evidence.json'), JSON.stringify(report, null, 2) + '\n'); }
console.log(`Quoted-name fix verified. Report: ${destination}`);
