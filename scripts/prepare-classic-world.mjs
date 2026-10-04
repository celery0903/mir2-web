import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { legacyMap, collisionRows } from './native-map.mjs';

const [seed, assets, output] = process.argv.slice(2).map(value => resolve(value));
const mapIDs = ['0', '0102', '0103', '0104', '0105', '0106', '0108', '0109', '0132', '0140', '0141'];
const names = ['比奇省', '肉店', '铁器店', '技能书店', '首饰店', '衣服店', '药店', '炼药房', '边界书店', '边界仓库', '边界杂货店'];
const supported = new Set(mapIDs);
const visibleMonsters = new Set(['鸡', '鹿', '稻草人', '多钩猫', '钉耙猫', '蛤蟆', '半兽人', '食人花', '森林雪人', '毒蜘蛛']);
const readText = async file => new TextDecoder('gbk').decode(await readFile(join(seed, 'Mir200/Envir', file)));
const writeText = (file, text) => writeFile(join(output, 'Envir', file), '\uFEFF' + text);
await mkdir(join(output, 'Map'), { recursive: true });
await mkdir(join(output, 'Envir'), { recursive: true });
await mkdir(join(output, 'Envir/Market_Def'), { recursive: true });
await mkdir(join(output, 'Envir/MapQuest_def'), { recursive: true });
const audit = [];
for (const [index, id] of mapIDs.entries()) {
  let source;
  try { source = await readFile(join(assets, 'server-maps', `${id}.map`)); }
  catch { source = await readFile(join(seed, 'Mir200/Map', `${id}.map`)); }
  const map = legacyMap(source);
  const rows = collisionRows(map);
  const browser = JSON.parse(await readFile(join(assets, id === '0' ? 'collision.json' : `maps/${id}/collision.json`)));
  let differences = 0;
  if (browser.rows.length !== rows.length || browser.rows[0].length !== rows[0].length) throw new Error(`Map ${id} dimensions differ`);
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) if (rows[y][x] !== browser.rows[y][x]) differences++;
  if (differences) throw new Error(`Map ${id} has ${differences} collision mismatches`);
  await writeFile(join(output, 'Map', `${id}.map`), map);
  audit.push({ id, name: names[index], width: rows[0].length, height: rows.length, collisionMismatches: differences });
}
const connections = (await readText('MapInfo.txt')).split(/\r?\n/).filter(line => {
  const match = /^\s*(\S+)\s+(\d+,\d+)\s+->\s+(\S+)\s+(\d+,\d+)/.exec(line);
  return match && supported.has(match[1]) && supported.has(match[3]);
});
await writeText('MapInfo.txt', mapIDs.map((id, index) => `[${id} ${names[index]}]${id === '0' ? ' DAY' : ''}`).join('\n') + '\n\n' + connections.join('\n') + '\n');
for (const [file, mapColumn] of [['MonGen.txt', 0], ['MerChant.txt', 1], ['Npcs.txt', 2]]) {
  const lines = (await readText(file)).split(/\r?\n/).filter(line => {
    const fields = line.trim().split(/\s+/);
    if (!supported.has(fields[mapColumn])) return false;
    if (file === 'MonGen.txt' && !visibleMonsters.has(fields[3])) return false;
    return file !== 'MerChant.txt' || /^(比奇城|边界村|银杏村)\//.test(fields[0]);
  });
  await writeText(file === 'MerChant.txt' ? 'Merchant.txt' : file, lines.join('\n') + '\n');
}
await writeText('StartPoint.txt', '0 289 618\n');
await writeText('MapQuest.txt', '');
await writeText('Robot.txt', '');
await writeText('AutoLogin.txt', '');
await writeText('Market_Def/QFunction-0.txt', '');
await writeText('MapQuest_def/QManage.txt', '');
const experience = JSON.parse(await readFile(new URL('../shared/classic-experience.json', import.meta.url)));
await writeFile(join(output, 'exps.conf'), '\uFEFF[Exp]\nKillMonExpMultiple=1\nHighLevelKillMonFixExp=FALSE\nHighLevelGroupFixExp=FALSE\nUseFixExp=FALSE\nMonDelHptoExp=FALSE\n' + Array.from({ length: 256 }, (_, level) => `Level${level}=${level === 0 ? 100 : experience.requiredExperience[level - 1] ?? 2000000000}`).join('\n') + '\n');
await writeFile(join(output, 'audit.json'), JSON.stringify({ maps: audit, connections: connections.length, scope: 'Bichon and ten interiors; not a complete 1.76 world' }, null, 2) + '\n');
console.log(`Prepared ${audit.length} maps with identical browser/server collision and ${connections.length} classic entrances.`);
