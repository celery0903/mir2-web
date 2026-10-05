import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';

const execute = promisify(execFile);
const work = await mkdtemp(resolve('.runtime/item-audit-checks-'));
const destination = resolve(process.env.MIR_ITEM_AUDIT_TEST_REPORT ?? '.runtime/reports/classic-item-audit-checks');
await mkdir(destination, { recursive: true });
const fixture = {
  'MapInfo.txt': '[0|map0 loaded]\n',
  'Merchant.txt': 'fixture 0 1 1 店主 0 2 0\nignored 9 1 1 未加载 0 2 0\n',
  'Npcs.txt': '',
  'MapQuest.txt': '',
  'MonGen.txt': '0 1 1 稻草人 1 1 1\n9 1 1 不可达怪物 1 1 1\n',
  'Market_Def/fixture-0.txt': '(@buy)\n%110\n+4\n[goods]\n"火球术" 3 60\n[@main]\n#IF\nCHECKITEM 木剑 1\n#ACT\nGIVE 金币 2\n#ELSEACT\nGIVE 基本剑术 1\n#SAY\nGIVE 白日门火球术 1\n[@other]\n#ACT\nGIVE <$STR(S0)> 1\n',
  'Market_Def/ignored-9.txt': '[@main]\n#ACT\nGIVE 白日门火球术 1\n',
  'Market_Def/unregistered-0.txt': '[@main]\n#ACT\nGIVE 怒之烈火 1\n',
  'MonItems/稻草人.txt': '; comment\n3/10 "火球术" 2\n10/10 金币 20\n0/10 白日门火球术 1\n',
  'MonItems/不可达怪物.txt': '1/1 怒之烈火 1\n'
};
for (const [file, text] of Object.entries(fixture)) {
  await mkdir(dirname(join(work, 'Envir', file)), { recursive: true });
  await writeFile(join(work, 'Envir', file), '\uFEFF' + text);
}
if (process.env.MIR_ITEM_AUDIT_ENGINE_IMAGE) {
  const container = (await execute('docker', ['create', process.env.MIR_ITEM_AUDIT_ENGINE_IMAGE])).stdout.trim();
  try { await execute('docker', ['cp', `${container}:/engine`, work]); }
  finally { await execute('docker', ['rm', container]); }
} else await execute('docker', ['cp', 'mir2-web-engine-1:/engine', work]);
await mkdir(join(work, 'checks'));
for (const file of ['Program.cs', 'ItemAudit.csproj']) await copyFile(join('scripts/item-audit', file), join(work, 'checks', file));
const report = { passed: false, full176Acceptance: false,
  source: process.env.MIR_ITEM_AUDIT_ENGINE_IMAGE ?? 'mir2-web-engine-1',
  scope: 'Actual extracted native DLLs; declared roots, inactive files, script branches, quoted goods/drops, currency and dynamic names.' };
try {
  const result = await execute('docker', ['run', '--rm', '--network', 'none', '-v', `${work}/engine:/engine:ro`,
    '-v', `${work}/Envir:/snapshot`, '-v', `${work}/checks:/tests`, '-v', `${destination}:/output`,
    'mcr.microsoft.com/dotnet/sdk:8.0', 'dotnet', 'run', '--project', '/tests/ItemAudit.csproj', '-c', 'Release',
    '--', '/snapshot', '/output/native-references.json'], { timeout: 120000, maxBuffer: 1024 * 1024 });
  await writeFile(join(destination, 'native-output.log'), result.stdout + result.stderr);
  const native = JSON.parse(await readFile(join(destination, 'native-references.json')));
  for (const [file, hash] of Object.entries(native.assemblies))
    assert.equal(createHash('sha256').update(await readFile(join(work, 'engine/GameSrv', file))).digest('hex'), hash);
  for (const [file, text] of Object.entries(fixture)) assert.equal(await readFile(join(work, 'Envir', file), 'utf8'), '\uFEFF' + text);
  assert.deepEqual(native.loadedMaps, ['0'], 'Graphic alias was mistaken for a loaded map ID');
  assert.deepEqual(native.spawnMonsters, ['稻草人'], 'An inactive spawn table entered the item audit');
  assert.equal(native.scriptRoots.length, 1, 'Stored or undeclared merchant scripts entered the audit');
  assert.equal(native.references.length, 7);
  assert.ok(native.references.every(reference => !['白日门火球术', '怒之烈火'].includes(reference.name)), 'Dialogue text or inactive scripts became item references');
  const shop = native.references.find(reference => reference.kind === 'shop-goods');
  assert.equal(shop.name, '火球术');
  assert.deepEqual(shop.details, { count: 3, refillTime: 60, priceRate: 110 });
  const drop = native.references.find(reference => reference.kind === 'monster-drop' && reference.name === '火球术');
  assert.deepEqual(drop.details, { numerator: 3, denominator: 10, count: 2 });
  assert.equal(native.references.filter(reference => reference.currency).length, 2);
  assert.ok(native.references.some(reference => reference.kind === 'CHECKITEM' && reference.name === '木剑'));
  assert.ok(native.references.some(reference => reference.kind === 'Give' && reference.name === '基本剑术'), 'Else action was omitted');
  assert.ok(native.references.some(reference => reference.name === '<$STR(S0)>' && reference.dynamic));
  assert.ok(native.findings.some(finding => finding.kind === 'merchant-outside-loaded-maps'));
  assert.deepEqual(native.nativeLog, []);
  report.passed = true;
  report.assemblies = native.assemblies;
  report.checkedReferences = native.references.length;
} catch (error) { report.error = String(error); throw error; }
finally { await writeFile(join(destination, 'evidence.json'), JSON.stringify(report, null, 2) + '\n'); }
console.log(`Native item audit checks passed. Report: ${destination}`);
