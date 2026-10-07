import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const execute = promisify(execFile);
const destination = resolve(process.env.MIR_GROUP_PROXY_REPORT ?? '.runtime/reports/group-proxy');
const work = await mkdtemp(resolve('.runtime/group-proxy-checks-'));
await mkdir(destination, { recursive: true });
const report = { passed: false, full176Acceptance: false,
  scope: 'Actual proxy image assembly; saved group permission in native MessageBodyWL login payload.', results: {} };
try {
  for (const [label, image] of [
    ['before', process.env.MIR_GROUP_PROXY_BEFORE_IMAGE ?? 'mir2-web-source-proxy:before-group-mode'],
    ['after', process.env.MIR_GROUP_PROXY_IMAGE ?? 'mir2-group-proxy:test']
  ]) {
    const run = join(work, label);
    await mkdir(join(run, 'checks'), { recursive: true });
    const imageID = (await execute('docker', ['image', 'inspect', image, '--format', '{{.Id}}'])).stdout.trim();
    const container = (await execute('docker', ['create', imageID])).stdout.trim();
    try { await execute('docker', ['cp', `${container}:/app`, run]); }
    finally { await execute('docker', ['rm', container]); }
    for (const file of ['Program.cs', 'GroupProxyChecks.csproj']) await copyFile(join('tests/group-proxy', file), join(run, 'checks', file));
    const hash = createHash('sha256').update(await readFile(join(run, 'app/WebGateway.dll'))).digest('hex');
    const result = { image: imageID, proxyAssemblySha256: hash };
    try {
      Object.assign(result, await execute('docker', ['run', '--rm', '--network', 'none',
        '-v', `${run}/app:/proxy:ro`, '-v', `${run}/checks:/tests`,
        'mcr.microsoft.com/dotnet/sdk:10.0', 'dotnet', 'run', '--project', '/tests/GroupProxyChecks.csproj', '-c', 'Release', '-p:MirGroupAssemblyDir=/proxy'],
      { timeout: 120000, maxBuffer: 1024 * 1024 }), { exitCode: 0 });
    } catch (error) { Object.assign(result, { exitCode: error.code, stdout: error.stdout, stderr: error.stderr }); }
    report.results[label] = result;
    assert.ok(result.stdout?.includes(`Proxy assembly SHA-256: ${hash}`));
    result.cases = JSON.parse(/^GROUP_PROXY_RESULTS=(.+)$/m.exec(result.stdout)?.[1] ?? 'null');
    assert.ok(Array.isArray(result.cases));
    console.log(`${label}: ${result.stdout.trim().split('\n').at(-1)}`);
  }
  assert.ok(report.results.before.cases.some(test => test.label === 'saved permission on' && !test.passed));
  assert.equal(report.results.after.exitCode, 0);
  assert.ok(report.results.after.cases.every(test => test.passed));
  report.passed = true;
} catch (error) { report.error = String(error); throw error; }
finally { await writeFile(join(destination, 'evidence.json'), JSON.stringify(report, null, 2) + '\n'); }
