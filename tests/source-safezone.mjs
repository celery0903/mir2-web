import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const execute = promisify(execFile);
const destination = resolve(process.env.MIR_SAFEZONE_REPORT ?? '.runtime/reports/source-safezone');
const work = resolve(process.env.MIR_SAFEZONE_WORKDIR ?? '.runtime/source-safezone-assemblies');
const before = process.env.MIR_SAFEZONE_BEFORE_IMAGE ?? 'sha256:62d10be31891bc4cac795ceda5eacbbfabc89105c3d316049e7347075e5095ea';
const after = process.env.MIR_SAFEZONE_ENGINE_IMAGE ?? 'mir2-source-safezone-engine:test';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const reference = { repository: 'lzxsz/MIR2', revision: '98711dad31567d9a7e272956f6c5a2487000848b',
  file: 'GameOfMir/M2Server/ObjBase.pas', sha256: '622bc35df593801fce3f028497250fbf171d0c03a5dbecafd251b69045ed6148',
  methods: ['TBaseObject.InSafeZone', 'TBaseObject.InSafeZone(Envir, nX, nY)'],
  scope: 'SAFE maps, RedHome and StartPoint squares; uses existing SafeZoneSize=10. This is player protection, not a claim that wildlife can no longer kill idle players.' };
assert.equal(digest(await readFile(join('.runtime/legacy-source', reference.file))), reference.sha256);
await mkdir(destination, { recursive: true });
const lock = JSON.parse(await readFile('shared/native-world.lock.json'));
const report = { checkedAt: new Date().toISOString(), passed: false, full176Acceptance: false, authenticated2003Client: false,
  reference, results: {}, tests: Object.fromEntries(await Promise.all(['server/openmir2-safezone.patch', 'tests/safezone/Program.cs', 'tests/world-maps/Program.cs', 'shared/native-world.lock.json'].map(async file => [file, digest(await readFile(file))]))) };
async function run(folder, name, mounts = []) {
  const project = join(folder, name); await mkdir(project, { recursive: true });
  const csproj = name === 'safezone' ? 'SafeZoneChecks.csproj' : 'WorldMapChecks.csproj';
  for (const file of ['Program.cs', csproj]) await copyFile(join('tests', name, file), join(project, file));
  try {
    const output = await execute('docker', ['run', '--rm', '-v', `${folder}/engine:/engine:ro`, '-v', `${project}:/tests`, ...mounts,
      'mcr.microsoft.com/dotnet/sdk:8.0', 'dotnet', 'run', '--project', `/tests/${csproj}`, '-c', 'Release', '--nologo'], { timeout: 60000, maxBuffer: 1024 * 1024 });
    return { exitCode: 0, ...output };
  } catch (error) { return { exitCode: error.code, stdout: error.stdout, stderr: error.stderr }; }
}
for (const [name, tag] of [['before', before], ['after', after]]) {
  const { stdout: image } = await execute('docker', ['image', 'inspect', tag, '--format', '{{.Id}}']);
  const { stdout: container } = await execute('docker', ['create', image.trim()]);
  const folder = join(work, name); await mkdir(folder, { recursive: true });
  try { await execute('docker', ['cp', `${container.trim()}:/engine`, folder]); }
  finally { await execute('docker', ['rm', container.trim()]); }
  const assemblySha256 = digest(await readFile(join(folder, 'engine/GameSrv/M2Server.dll')));
  const result = await run(folder, 'safezone');
  report.results[name] = { image: image.trim(), assemblySha256, loadedDeclaredAssembly: result.stdout?.includes(`Assembly SHA-256: ${assemblySha256}`), ...result };
  if (name === 'after') report.nativeMaps = await run(folder, 'world-maps', ['-v', `${resolve('.runtime/mirserver-source/Mir200/Map')}:/maps:ro`, '-v', `${resolve('shared/native-world.lock.json')}:/world-lock.json:ro`]);
}
report.passed = report.results.before.loadedDeclaredAssembly && report.results.after.loadedDeclaredAssembly
  && report.results.before.exitCode === 1 && report.results.before.stdout.includes('The birth point is not recognized on an ordinary map')
  && report.results.before.stdout.includes('Outside player can target a player at the birth point')
  && report.results.after.exitCode === 0 && report.results.after.stdout.includes('Safe-zone checks: 8/8 passed.')
  && report.nativeMaps.exitCode === 0 && report.nativeMaps.stdout.includes(`Native world map checks: ${lock.maps.length} maps,`)
  && report.nativeMaps.stdout.includes(`Assembly SHA-256: ${report.results.after.assemblySha256}`);
await writeFile(join(destination, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
assert.equal(report.passed, true);
