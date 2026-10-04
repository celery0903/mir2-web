import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, copyFile, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const execute = promisify(execFile);
const destination = resolve(process.env.MIR_SCRIPT_REPORT ?? '.runtime/reports/source-script');
await mkdir(destination, { recursive: true });
await mkdir('.runtime/source-script-assemblies', { recursive: true });
const report = { checkedAt: new Date().toISOString(), scope: 'Actual native parser and dispatcher, without database fixtures', passed: false, full176Acceptance: false, results: {} };
for (const [label, image] of [
  ['before', process.env.MIR_SCRIPT_BEFORE_IMAGE ?? 'sha256:519337af03c439c643ee45799c7f09e975bc292cb035915f0082ab148042f0ed'],
  ['after', process.env.MIR_SCRIPT_ENGINE_IMAGE ?? 'mir2-world-review-engine:test']
]) {
  const work = await mkdtemp(resolve('.runtime/source-script-assemblies/run-'));
  const imageID = (await execute('docker', ['image', 'inspect', image, '--format', '{{.Id}}'])).stdout.trim();
  const container = (await execute('docker', ['create', imageID])).stdout.trim();
  try { await execute('docker', ['cp', `${container}:/engine`, work]); }
  finally { await execute('docker', ['rm', container]); }
  const checks = join(work, 'checks');
  await mkdir(checks);
  for (const file of ['Program.cs', 'ScriptChecks.csproj']) await copyFile(join('tests/script', file), join(checks, file));
  const hash = createHash('sha256').update(await readFile(join(work, 'engine/GameSrv/ScriptSystem.dll'))).digest('hex');
  const result = { image: imageID, assemblySha256: hash };
  try {
    Object.assign(result, await execute('docker', ['run', '--rm', '-v', `${work}/engine:/engine:ro`, '-v', `${checks}:/tests`,
      'mcr.microsoft.com/dotnet/sdk:8.0', 'dotnet', 'run', '--project', '/tests/ScriptChecks.csproj', '-c', 'Release', '--nologo'],
    { timeout: 120000, maxBuffer: 1024 * 1024 }), { exitCode: 0 });
  } catch (error) { Object.assign(result, { exitCode: error.code, stdout: error.stdout, stderr: error.stderr }); }
  assert.ok(result.stdout.includes(`Script assembly SHA-256: ${hash}`), 'Loaded script assembly differs from the declared image');
  report.results[label] = result;
}
report.passed = report.results.before.exitCode !== 0 && report.results.before.stderr.includes('became Exeaction, expected MapMove')
  && report.results.after.exitCode === 0 && report.results.after.stdout.includes('sequential actions and BREAK passed.');
await writeFile(join(destination, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: report.passed, before: report.results.before.exitCode, after: report.results.after.exitCode, full176Acceptance: false }, null, 2));
assert.equal(report.passed, true, `Script checks failed; see ${destination}/evidence.json`);
