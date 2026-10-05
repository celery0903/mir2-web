import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, copyFile, readdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { archivedMapPins } from '../scripts/native-map.mjs';

const execute = promisify(execFile);
const destination = resolve(process.env.MIR_WORLD_PROFILE_REPORT ?? '.runtime/reports/source-world-profile');
const profile = resolve(process.env.MIR_WORLD_PROFILE ?? '.runtime/classic-world/profile');
await mkdir(destination, { recursive: true });
await mkdir('.runtime/source-world-profile-assemblies', { recursive: true });
const work = await mkdtemp(resolve('.runtime/source-world-profile-assemblies/run-'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const { stdout: imageID } = await execute('docker', ['image', 'inspect', process.env.MIR_WORLD_PROFILE_IMAGE ?? 'mir2-world-review-engine:test', '--format', '{{.Id}}']);
const { stdout: container } = await execute('docker', ['create', imageID.trim()]);
try {
  await execute('docker', ['cp', `${container.trim()}:/engine`, work]);
  await execute('docker', ['cp', `${container.trim()}:/profile`, work]);
}
finally { await execute('docker', ['rm', container.trim()]); }
const checks = join(work, 'checks');
await mkdir(checks, { recursive: true });
for (const file of ['Program.cs', 'WorldProfileChecks.csproj']) await copyFile(join('tests/world-profile', file), join(checks, file));
const assemblySha256 = digest(await readFile(join(work, 'engine/GameSrv/M2Server.dll')));
const world = JSON.parse(await readFile('shared/native-world.lock.json'));
const archive = JSON.parse(await readFile('shared/archived-176-client.lock.json'));
await writeFile(join(work, 'world-lock.json'), JSON.stringify({ ...world, maps: archivedMapPins(world, archive) }));
const report = { checkedAt: new Date().toISOString(), image: imageID.trim(), assemblySha256, profile, passed: false, full176Acceptance: false,
  scope: 'Actual image profile identity and native loading; not full route, service or gameplay acceptance',
  profileVersion: (await readFile(join(profile, 'profile.version'), 'utf8')).trim(), preparedAudit: JSON.parse(await readFile(join(profile, 'audit.json'))),
  testSha256: digest(await readFile('tests/world-profile/Program.cs')) };
async function fileHashes(directory, relative = '') {
  const entries = [];
  for (const entry of (await readdir(join(directory, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) entries.push(...await fileHashes(directory, path));
    else entries.push([path, digest(await readFile(join(directory, path)))]);
  }
  return entries;
}
try {
  const expected = await fileHashes(profile), actual = await fileHashes(join(work, 'profile'));
  // Audit JSON includes context-specific diagnostics; deployed world bytes must agree exactly.
  assert.deepEqual(actual.filter(([path]) => path !== 'audit.json'), expected.filter(([path]) => path !== 'audit.json'), 'Image profile differs from the prepared world');
  report.imageProfile = { matched: true, files: actual.filter(([path]) => path !== 'audit.json').length, contentSha256: digest(JSON.stringify(actual.filter(([path]) => path !== 'audit.json'))) };
  const imageAudit = JSON.parse(await readFile(join(work, 'profile/audit.json')));
  for (const key of ['maps', 'connections', 'services', 'dependencies', 'scriptPaths', 'unavailableScripts', 'scriptFindings', 'excludedGlobalHooks', 'candidateServiceAcceptance']) {
    assert.deepEqual(imageAudit[key], report.preparedAudit[key], `Image profile audit differs: ${key}`);
  }
  const result = await execute('docker', ['run', '--rm', '-v', `${work}/engine:/engine:ro`, '-v', `${checks}:/tests`, '-v', `${work}/profile:/profile:ro`,
    '-v', `${work}/world-lock.json:/world-lock.json:ro`, 'mcr.microsoft.com/dotnet/sdk:8.0',
    'dotnet', 'run', '--project', '/tests/WorldProfileChecks.csproj', '-c', 'Release', '--nologo'], { timeout: 120000, maxBuffer: 1024 * 1024 });
  Object.assign(report, result, { exitCode: 0 });
  assert.ok(result.stdout.includes(`Assembly SHA-256: ${assemblySha256}`), 'Loaded assembly differs from the declared image');
  assert.ok(result.stdout.includes(`Native world profile checks: ${report.preparedAudit.maps.length} maps, ${report.preparedAudit.connections} route declarations,`));
  report.unavailableRoutes = JSON.parse(result.stdout.match(/^Unavailable source routes: (.+)$/m)[1]);
  report.nativeCollisionCellsChecked = Number(result.stdout.match(/^Native collision cells checked: (\d+)$/m)[1]);
  assert.equal(report.nativeCollisionCellsChecked, report.preparedAudit.maps.reduce((sum, map) => sum + map.width * map.height, 0));
  report.routeAcceptance = report.unavailableRoutes.length ? 'failed' : 'unverified';
  report.passed = true;
} catch (error) {
  Object.assign(report, { exitCode: error.code ?? 1, stdout: error.stdout, stderr: error.stderr, error: error.message });
} finally { await writeFile(join(destination, 'evidence.json'), JSON.stringify(report, null, 2) + '\n'); }
console.log(report.stdout ?? report.error);
if (!report.passed && report.stderr) console.error(report.stderr);
assert.equal(report.passed, true, `Native world profile failed; see ${destination}/evidence.json`);
