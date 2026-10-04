import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { legacyMap, collisionRows } from './native-map.mjs';

const args = process.argv.slice(2);
if (args.some(arg => arg.startsWith('--') && arg !== '--all')) throw new Error('Unknown world option');
if (process.env.MIR_WORLD_SCOPE && !['default', 'all'].includes(process.env.MIR_WORLD_SCOPE)) throw new Error('Unknown MIR_WORLD_SCOPE');
const full = args.includes('--all') || process.env.MIR_WORLD_SCOPE === 'all';
const paths = args.filter(arg => !arg.startsWith('--'));
if (paths.length !== 3) throw new Error('Expected seed, legacy assets and output paths');
const [seed, assets, output] = paths.map(value => resolve(value));
const nativeWorld = JSON.parse(await readFile(new URL('../shared/native-world.lock.json', import.meta.url)));
const selectedMaps = full ? nativeWorld.maps : nativeWorld.defaultMapIDs.map(id => nativeWorld.maps.find(map => map.id === id));
const mapIDs = selectedMaps.map(map => map.id);
const names = full ? selectedMaps.map(map => map.name) : ['比奇省', '肉店', '铁器店', '技能书店', '首饰店', '衣服店', '药店', '炼药房', '边界书店', '边界仓库', '边界杂货店'];
const supported = new Set(mapIDs);
const normalizedMaps = new Set(mapIDs.map(id => id.toLowerCase()));
const hasMap = id => Boolean(id) && (full ? normalizedMaps.has(id.toLowerCase()) : supported.has(id));
const nativeMaps = new Map(selectedMaps.map(map => [map.id, map]));
const visibleMonsters = new Set(['鸡', '鹿', '稻草人', '多钩猫', '钉耙猫', '蛤蟆', '半兽人', '食人花', '森林雪人', '毒蜘蛛']);
const serviceLock = full ? JSON.parse(await readFile(new URL('../shared/classic-world-services.lock.json', import.meta.url))) : null;
if (full && (serviceLock.repository !== nativeWorld.repository || serviceLock.revision !== nativeWorld.revision)) throw new Error('World service and map source pins differ');
const sourceFiles = new Map();
const readText = async file => {
  const raw = await readFile(join(seed, 'Mir200/Envir', file));
  if (full) {
    const entry = serviceLock.files.find(entry => entry.file === file);
    if (!entry || raw.length !== entry.bytes || createHash('sha256').update(raw).digest('hex') !== entry.sha256) throw new Error(`World service checksum mismatch: ${file}`);
    sourceFiles.set(file, entry);
  }
  return new TextDecoder('gbk').decode(raw);
};
const writeText = (file, text) => writeFile(join(output, 'Envir', file), '\uFEFF' + text);
const storage = JSON.parse(await readFile(new URL('../shared/classic-storage.json', import.meta.url)));
await mkdir(join(output, 'Map'), { recursive: true });
await mkdir(join(output, 'Envir'), { recursive: true });
await mkdir(join(output, 'Envir/Market_Def'), { recursive: true });
await mkdir(join(output, 'Envir/MapQuest_def'), { recursive: true });
const audit = [];
for (const [index, id] of mapIDs.entries()) {
  let source;
  const pin = nativeMaps.get(id);
  if (pin) {
    source = await readFile(join(seed, 'Mir200/Map', pin.sourceFile ?? `${id}.map`));
    if (source.length !== pin.bytes || createHash('sha256').update(source).digest('hex') !== pin.sha256) throw new Error(`Native map checksum mismatch: ${id}`);
  } else {
    try { source = await readFile(join(assets, 'server-maps', `${id}.map`)); }
    catch { source = await readFile(join(seed, 'Mir200/Map', `${id}.map`)); }
  }
  const map = legacyMap(source, { trailingBytes: pin?.trailingBytes ?? 0 });
  const rows = collisionRows(map);
  const browser = full ? null : JSON.parse(await readFile(join(assets, id === '0' ? 'collision.json' : `maps/${id}/collision.json`)));
  let differences = 0;
  if (browser) {
    if (browser.rows.length !== rows.length || browser.rows[0].length !== rows[0].length) throw new Error(`Map ${id} dimensions differ`);
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) if (rows[y][x] !== browser.rows[y][x]) differences++;
  }
  if (differences && !pin) throw new Error(`Map ${id} has ${differences} collision mismatches`);
  await writeFile(join(output, 'Map', `${full ? pin.graphicID : id}.map`), map);
  audit.push({ id, name: names[index], width: rows[0].length, height: rows.length,
    collisionMismatches: pin ? null : differences,
    ...(pin ? { sourceSha256: pin.sha256, resourceNamespace: 'WemadeMir2', graphicID: pin.graphicID, ...(browser ? { previousCollisionDifferences: differences } : {}), browserCollisionVerification: 'pending export' } : {}) });
}
const mapInfo = (await readText('MapInfo.txt')).split(/\r?\n/);
const connections = mapInfo.filter(line => {
  const match = /^\s*(\S+)\s+(\d+)[,\s]+(\d+)\s+->\s+(\S+)\s+(\d+)[,\s]+(\d+)/.exec(line);
  return match && hasMap(match[1]) && hasMap(match[4]);
});
const declarations = full ? mapInfo.filter(line => {
  const match = /^\s*\[([^\s|\]]+)(?:\|([^\s\]]+))?\s+([^\]]+)\]\s*(.*)/.exec(line);
  if (!match || !supported.has(match[1])) return false;
  const pin = nativeMaps.get(match[1]);
  if ((match[2] ?? match[1]) !== pin.graphicID || match[3].trim() !== pin.name || match[4].trim() !== pin.flags) throw new Error(`Map declaration differs from its pin: ${match[1]}`);
  return true;
}) : mapIDs.map((id, index) => `[${id} ${names[index]}]${id === '0' ? ' DAY' : ''}`);
if (declarations.length !== mapIDs.length) throw new Error('Missing or duplicate map declarations');
await writeText('MapInfo.txt', declarations.join('\n') + '\n\n' + connections.join('\n') + '\n');
const services = {};
for (const [file, mapColumn] of [['MonGen.txt', 0], ['MerChant.txt', 1], ['Npcs.txt', 2]]) {
  const lines = (await readText(file)).split(/\r?\n/).filter(line => {
    const fields = line.trim().split(/\s+/);
    if (!hasMap(fields[mapColumn])) return false;
    if (/^\s*;/.test(line)) return false;
    if (file === 'MonGen.txt' && !full && !visibleMonsters.has(fields[3])) return false;
    return full || file !== 'MerChant.txt' || /^(比奇城|边界村|银杏村)\//.test(fields[0]);
  });
  if (file === 'MerChant.txt') lines.push(storage.merchant);
  services[file] = lines;
  await writeText(file === 'MerChant.txt' ? 'Merchant.txt' : file, lines.join('\n') + '\n');
}
await mkdir(join(output, 'Envir/Market_Def', dirname(storage.script)), { recursive: true });
await writeText(`Market_Def/${storage.script}`, storage.dialogue.join('\n') + '\n');
const dependencies = [], scriptPaths = [], unavailableScripts = [], scriptFindings = [];
if (full) {
  // These are source candidates, not approved 2003 scripts; keep their defects visible.
  const requested = new Set();
  for (const map of selectedMaps) for (const match of map.flags.matchAll(/CHECKQUEST\(([^)]+)\)/gi)) {
    const key = `MapQuest_def/${match[1]}.txt`;
    const entry = serviceLock.files.find(entry => entry.file.toLowerCase() === key.toLowerCase());
    if (entry) requested.add(entry.file);
    else unavailableScripts.push({ declaration: map.id, script: key });
    scriptFindings.push({ file: 'MapInfo.txt', map: map.id, kind: 'map-quest-review-required', script: key });
  }
  for (const [file, directory, mapColumn] of [['MerChant.txt', 'Market_Def', 1], ['Npcs.txt', 'Npc_Def', 2]]) {
    for (const line of services[file]) {
      if (line === storage.merchant) continue;
      const fields = line.trim().split(/\s+/);
      const key = `${directory}/${fields[0]}-${fields[mapColumn]}.txt`;
      const entry = serviceLock.files.find(entry => entry.file.toLowerCase() === key.toLowerCase());
      if (entry) requested.add(entry.file);
      else unavailableScripts.push({ declaration: line, script: key });
    }
  }
  const spawnNames = new Set(services['MonGen.txt'].map(line => line.trim().split(/\s+/)[3]));
  for (const entry of serviceLock.files) if (entry.file.startsWith('MonItems/') && spawnNames.has(entry.file.slice('MonItems/'.length, -4))) requested.add(entry.file);
  for (const file of requested) {
    const text = await readText(file);
    // The Linux native loader spells its quest NPC directory Npc_def.
    const installedFile = file.replace(/^Npc_Def\//, 'Npc_def/');
    await mkdir(join(output, 'Envir', dirname(installedFile)), { recursive: true });
    await writeText(installedFile, text);
    dependencies.push(file);
    scriptPaths.push({ source: file, installed: installedFile });
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      const move = /^\s*(?:MAPMOVE|MAP)\s+(\S+)/i.exec(line);
      if (move && !hasMap(move[1]) && !move[1].includes('<$')) scriptFindings.push({ file, line: index + 1, kind: 'outside-catalog-map', target: move[1] });
      if (/元宝|英雄|假人|人民币|自动升级|月卡/.test(line)) scriptFindings.push({ file, line: index + 1, kind: 'version-review-required', text: line.trim() });
      if (/^\s*#CALL\s+/i.test(line)) scriptFindings.push({ file, line: index + 1, kind: 'include-review-required', text: line.trim() });
    }
  }
  for (const [file, mapColumn] of [['StartPoint.txt', 0], ['GuardList.txt', 1], ['MapQuest.txt', 0]]) {
    const lines = (await readText(file)).split(/\r?\n/).filter(line => !/^\s*;/.test(line) && hasMap(line.trim().split(/\s+/)[mapColumn]));
    services[file] = lines;
    await writeText(file, lines.join('\n') + '\n');
  }
} else await writeText('StartPoint.txt', '0 289 618\n');
if (!full) await writeText('MapQuest.txt', '');
await writeText('Robot.txt', '');
await writeText('AutoLogin.txt', '');
await writeText('Market_Def/QFunction-0.txt', '');
await writeText('MapQuest_def/QManage.txt', '');
const experience = JSON.parse(await readFile(new URL('../shared/classic-experience.json', import.meta.url)));
await writeFile(join(output, 'exps.conf'), '\uFEFF[Exp]\nKillMonExpMultiple=1\nHighLevelKillMonFixExp=FALSE\nHighLevelGroupFixExp=FALSE\nUseFixExp=FALSE\nMonDelHptoExp=FALSE\n' + Array.from({ length: 256 }, (_, level) => `Level${level}=${level === 0 ? 100 : experience.requiredExperience[level - 1] ?? 2000000000}`).join('\n') + '\n');
await writeFile(join(output, 'audit.json'), JSON.stringify({ maps: audit, connections: connections.length,
  scope: full ? 'Full classic world candidate; version data and services require review' : 'Bichon and ten interiors; not a complete 1.76 world',
  ...(full ? { sourceRepository: serviceLock.repository, sourceRevision: serviceLock.revision, sourceFiles: [...sourceFiles.values()],
    services: Object.fromEntries(Object.entries(services).map(([file, lines]) => [file, lines.length])), dependencies, scriptPaths, unavailableScripts, scriptFindings,
    excludedGlobalHooks: ['AutoLogin.txt', 'Robot.txt', 'Market_Def/QFunction-0.txt', 'MapQuest_def/QManage.txt'],
    candidateServiceAcceptance: unavailableScripts.length || scriptFindings.length ? 'failed' : 'unverified',
    authenticated2003Data: false, full176Acceptance: false } : {}) }, null, 2) + '\n');
const profileFiles = [];
async function hashFiles(directory, relative = '') {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) await hashFiles(join(directory, entry.name), path);
    else if (path !== 'audit.json' && path !== 'profile.version') profileFiles.push([path, createHash('sha256').update(await readFile(join(directory, entry.name))).digest('hex')]);
  }
}
await hashFiles(output);
await writeFile(join(output, 'profile.version'), createHash('sha256').update(JSON.stringify(profileFiles)).digest('hex') + '\n');
console.log(`Prepared ${audit.length} maps and ${connections.length} classic entrances; native map browser collision is verified during asset export.`);
