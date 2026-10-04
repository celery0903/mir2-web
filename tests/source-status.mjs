import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {promisify} from 'node:util';

const execute = promisify(execFile), destination = resolve(process.env.MIR_STATUS_REPORT ?? '.runtime/reports/source-status');
const assemblies = resolve(process.env.MIR_STATUS_WORKDIR ?? '.runtime/source-status-assemblies');
const beforeImage = process.env.MIR_STATUS_BEFORE_IMAGE ?? 'sha256:3abd7135b4a3228fb673cc47efd2692e479627aa863f80653ec90c2ae4365ef0';
const afterImage = process.env.MIR_STATUS_ENGINE_IMAGE ?? 'mir2-source-status-engine:test';
const reference = {repository: 'lzxsz/MIR2', revision: '98711dad31567d9a7e272956f6c5a2487000848b', file: 'GameOfMir/M2Server/ObjBase.pas',
  sha256: '622bc35df593801fce3f028497250fbf171d0c03a5dbecafd251b69045ed6148',
  methods: ['GetCharStatus', 'MakePosion', 'DefenceUp', 'MagDefenceUp', 'MagBubbleDefenceUp', 'Run', 'DamageBubbleDefence'],
  additionalCorrection: 'Initialize the existing invisibility timer at cast time; this corrects a missing clock rather than claiming historical numerical authenticity.'};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(digest(await readFile(join('.runtime/legacy-source', reference.file))), reference.sha256);
await mkdir(destination, {recursive: true});
const report = {checkedAt: new Date().toISOString(), passed: false, authenticated2003Client: false, full176Acceptance: false,
  scope: 'Executes the real built OpenMir2 assemblies. Uses controlled clocks through the live per-actor status method for deterministic timer checks; does not prove complete skill workflows or authenticate 2003 numbers.', reference,
  tests: Object.fromEntries(await Promise.all(['tests/status/Program.cs', 'tests/status/StatusChecks.csproj', 'tests/native/Program.cs', 'server/openmir2-status.patch', 'server/openmir2-linux.patch'].map(async path => [path, digest(await readFile(path))]))), results: {}};
for (const [name, tag] of [['before', beforeImage], ['after', afterImage]]) {
  const {stdout: image} = await execute('docker', ['image', 'inspect', tag, '--format', '{{.Id}}']);
  const {stdout: container} = await execute('docker', ['create', image.trim()]);
  const folder = join(assemblies, name); await mkdir(folder, {recursive: true});
  try { await execute('docker', ['cp', `${container.trim()}:/engine`, folder]); }
  finally { await execute('docker', ['rm', container.trim()]); }
  const project = join(folder, 'project'); await mkdir(project, {recursive: true});
  for (const file of ['Program.cs', 'StatusChecks.csproj']) await copyFile(join('tests/status', file), join(project, file));
  const assemblySha256 = digest(await readFile(join(folder, 'engine/GameSrv/M2Server.dll')));
  let result;
  try {
    result = await execute('docker', ['run', '--rm', '-v', `${folder}/engine:/engine:ro`, '-v', `${project}:/tests`,
      'mcr.microsoft.com/dotnet/sdk:8.0', 'dotnet', 'run', '--project', '/tests/StatusChecks.csproj', '-c', 'Release', '--nologo'], {timeout: 60000, maxBuffer: 1024 * 1024});
    result.code = 0;
  } catch (error) { result = error; }
  report.results[name] = {image: image.trim(), assemblySha256, loadedDeclaredAssembly: result.stdout?.includes(`Assembly SHA-256: ${assemblySha256}`), exitCode: result.code, stdout: result.stdout, stderr: result.stderr};
  const inventoryProject = join(folder, 'native-project'); await mkdir(inventoryProject, {recursive: true});
  for (const file of ['Program.cs', 'NativeChecks.csproj']) await copyFile(join('tests/native', file), join(inventoryProject, file));
  let native;
  try {
    native = await execute('docker', ['run', '--rm', '-v', `${folder}/engine:/engine:ro`, '-v', `${inventoryProject}:/tests`,
      'mcr.microsoft.com/dotnet/sdk:8.0', 'dotnet', 'run', '--project', '/tests/NativeChecks.csproj', '-c', 'Release', '--nologo'], {timeout: 60000, maxBuffer: 1024 * 1024});
    native.code = 0;
  } catch (error) { native = error; }
  report.results[name].nativeInventory = {exitCode: native.code, stdout: native.stdout, stderr: native.stderr};
}
report.passed = report.results.before.loadedDeclaredAssembly && report.results.after.loadedDeclaredAssembly
  && report.results.before.exitCode === 1 && report.results.before.stdout.includes('Status checks: 0/8 passed.')
  && report.results.after.exitCode === 0 && report.results.after.stdout.includes('Status checks: 8/8 passed.')
  && report.results.before.nativeInventory.exitCode !== 0 && report.results.before.nativeInventory.stderr.includes('Empty bag queries must each receive a native response')
  && report.results.after.nativeInventory.exitCode === 0 && report.results.after.nativeInventory.stdout.includes('PASS: empty inventory sends a routed SM_BAGITEMS response with zero records.');
await writeFile(join(destination, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2)); assert.equal(report.passed, true);
