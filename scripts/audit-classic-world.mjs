import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { legacyMap } from './native-map.mjs';

const seed = resolve(process.argv[2] ?? '.runtime/mirserver-source');
const destination = resolve(process.argv[3] ?? 'docs/classic-world-audit.json');
const catalog = JSON.parse(await readFile(new URL('../shared/classic-world-catalog.json', import.meta.url)));
const libraryRules = JSON.parse(await readFile(new URL('../shared/classic-map-library-rules.json', import.meta.url)));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const verificationRoot = resolve(process.argv[4] ?? 'upstream/mir2-client/vendor/mirserver-data');
if (!/^[a-f0-9]{40}$/.test(catalog.sourceRevision)) throw new Error('Invalid source revision');
const commit = execFileSync('git', ['-C', verificationRoot, 'rev-parse', '--verify', `${catalog.sourceRevision}^{commit}`], { encoding: 'utf8' }).trim();
if (commit !== catalog.sourceRevision) throw new Error('Source revision mismatch');
const tree = execFileSync('git', ['-C', verificationRoot, 'ls-tree', '-rz', commit, '--', 'Mir200/Map', 'Mir200/Envir/MapInfo.txt', 'Mir200/Envir/MonGen.txt'], { encoding: 'utf8' });
const sourceBlobs = new Map(tree.split('\0').filter(Boolean).map(record => {
  const match = /^100644 blob ([a-f0-9]{40})\t(.+)$/.exec(record);
  if (!match) throw new Error(`Unsupported source tree entry: ${record}`);
  return [match[2], match[1]];
}));
async function readVerified(file) {
  const raw = await readFile(join(seed, file));
  const expected = sourceBlobs.get(file);
  const actual = createHash('sha1').update(`blob ${raw.length}\0`).update(raw).digest('hex');
  if (!expected || actual !== expected) throw new Error(`Source Git blob mismatch: ${file}`);
  return raw;
}
const readText = async file => new TextDecoder('gbk').decode(await readVerified(`Mir200/Envir/${file}`));
const mapInfoBytes = await readVerified('Mir200/Envir/MapInfo.txt');
const mapInfo = new TextDecoder('gbk').decode(mapInfoBytes);
const definitions = new Map();
const mapDirectory = join(seed, 'Mir200/Map');
const mapFiles = new Map();
for (const file of await readdir(mapDirectory)) {
  if (!/\.map$/i.test(file)) continue;
  const key = file.toLowerCase();
  if (mapFiles.has(key)) throw new Error(`Ambiguous map filename: ${file}`);
  mapFiles.set(key, file);
}
for (const line of mapInfo.split(/\r?\n/)) {
  const match = /^\s*\[([^\s|\]]+)(?:\|([^\s\]]+))?\s+([^\]]+)\]\s*(.*)/.exec(line);
  if (match) definitions.set(match[1], { id: match[1], graphicID: match[2] ?? match[1], name: match[3].trim(), flags: match[4].trim(), declaration: line.trim() });
}
const maps = [], parsed = new Map();
for (const group of catalog.groups) for (const id of group.ids) {
  const definition = definitions.get(id);
  const entry = { id, group: group.name, ...definition };
  if (!definition) { entry.acceptance = 'missing-definition'; maps.push(entry); continue; }
  try {
    entry.sourceFile = mapFiles.get(`${definition.graphicID}.map`.toLowerCase());
    if (!entry.sourceFile) throw new Error(`Map file absent: ${definition.graphicID}`);
    const sourcePath = `Mir200/Map/${entry.sourceFile}`;
    const raw = await readVerified(sourcePath);
    entry.bytes = raw.length; entry.sha256 = digest(raw); entry.gitBlob = sourceBlobs.get(sourcePath);
    const trailingBytes = catalog.legacyAuxiliaryTails?.[id] ?? 0;
    const map = legacyMap(raw, { trailingBytes });
    if (!map.equals(raw)) throw new Error('native catalog requires original classic-12 bytes');
    const width = map.readUInt16LE(0), height = map.readUInt16LE(2);
    const families = {}, refs = new Map([['Tiles', new Set()], ['SmTiles', new Set()]]);
    let blockedCells = 0;
    for (let cell = 0; cell < width * height; cell++) {
      const offset = 52 + cell * 12, x = Math.floor(cell / height), y = cell % height;
      blockedCells += Boolean((map.readUInt16LE(offset) | map.readUInt16LE(offset + 4)) & 0x8000);
      for (let layer = 0; layer < 3; layer++) {
        if (layer === 0 && (x % 2 || y % 2)) continue;
        const image = map.readUInt16LE(offset + layer * 2) & 0x7fff;
        if (!image || image >= 0x7f00) continue;
        const family = map[offset + 10];
        const effectiveFamily = family > libraryRules.objectFileByteMaximum ? libraryRules.outsideRangeFallback : family;
        const name = layer === 0 ? 'Tiles' : layer === 1 ? 'SmTiles' : effectiveFamily ? `Objects${effectiveFamily + 1}` : 'Objects';
        if (layer === 2) families[family] = (families[family] ?? 0) + 1;
        const indices = refs.get(name) ?? new Set();
        for (let n = 0; n < (layer === 2 ? Math.max(1, map[offset + 8] & 127) : 1); n++) indices.add(image - 1 + n);
        refs.set(name, indices);
      }
    }
    Object.assign(entry, { format: 'classic-12', width, height, ...(trailingBytes ? { trailingBytes } : {}), blockedCells, frontFileBytes: families,
      libraryReferences: Object.fromEntries([...refs].map(([name, values]) => [name, { count: values.size, maxIndex: values.size ? Math.max(...values) : null }])),
      acceptance: 'candidate-not-authenticated' });
    parsed.set(id, map);
  } catch (error) { entry.acceptance = 'unsupported-or-missing'; entry.reason = error.message; }
  maps.push(entry);
}
const selected = new Set(maps.map(map => map.id));
const connections = [], externalConnections = [];
function cell(mapID, x, y) {
  const raw = parsed.get(mapID);
  if (!raw) return { available: false };
  const width = raw.readUInt16LE(0), height = raw.readUInt16LE(2);
  if (x < 0 || y < 0 || x >= width || y >= height) return { available: true, inBounds: false };
  const at = 52 + (x * height + y) * 12;
  return { available: true, inBounds: true, blocked: Boolean((raw.readUInt16LE(at) | raw.readUInt16LE(at + 4)) & 0x8000), door: raw[at + 6] & 127 };
}
for (const line of mapInfo.split(/\r?\n/)) {
  const match = /^\s*(\S+)\s+(\d+)[,\s]+(\d+)\s+->\s+(\S+)\s+(\d+)[,\s]+(\d+)/.exec(line);
  if (!match || !selected.has(match[1]) && !selected.has(match[4])) continue;
  const entry = { from: match[1], x: Number(match[2]), y: Number(match[3]), to: match[4], targetX: Number(match[5]), targetY: Number(match[6]), source: line.trim() };
  if (!selected.has(entry.from) || !selected.has(entry.to)) { externalConnections.push(entry); continue; }
  entry.fromCell = cell(entry.from, entry.x, entry.y);
  entry.toCell = cell(entry.to, entry.targetX, entry.targetY);
  entry.physicalIssue = [entry.fromCell, entry.toCell].some(point => !point.available || !point.inBounds || point.blocked && !point.door);
  connections.push(entry);
}
const reachable = new Set(['0']);
for (let changed = true; changed;) {
  changed = false;
  for (const edge of connections) if (reachable.has(edge.from) && !reachable.has(edge.to)) { reachable.add(edge.to); changed = true; }
}
const spawnNames = new Map();
for (const line of (await readText('MonGen.txt')).split(/\r?\n/)) {
  if (/^\s*;/.test(line)) continue;
  const fields = line.trim().split(/\s+/);
  if (!selected.has(fields[0]) || fields.length < 7) continue;
  const names = spawnNames.get(fields[0]) ?? new Map();
  names.set(fields[3], (names.get(fields[3]) ?? 0) + 1); spawnNames.set(fields[0], names);
}
for (const map of maps) { map.graphReachableFromBichon = reachable.has(map.id); map.spawnNames = Object.fromEntries(spawnNames.get(map.id) ?? []); }
const report = { checkedAt: new Date().toISOString(), sourceRepository: catalog.sourceRepository, sourceRevision: catalog.sourceRevision,
  sourceMapInfoSha256: digest(mapInfoBytes), sourceMapInfoGitBlob: sourceBlobs.get('Mir200/Envir/MapInfo.txt'),
  sourceMonGenGitBlob: sourceBlobs.get('Mir200/Envir/MonGen.txt'), sourceBytesMatchPinnedGitTree: maps.every(map => Boolean(map.gitBlob)),
  libraryRules, full176Acceptance: false, authenticated2003Client: false,
  mapCount: maps.length, recognizedMaps: parsed.size, unsupportedMaps: maps.filter(map => !parsed.has(map.id)).map(map => ({ id: map.id, reason: map.reason ?? map.acceptance })),
  requiredLibraries: [...new Set(maps.flatMap(map => Object.keys(map.libraryReferences ?? {})))].sort(),
  graphReachableCount: reachable.size, unreachableMapIDs: maps.filter(map => !reachable.has(map.id)).map(map => map.id),
  physicalConnectionIssues: connections.filter(edge => edge.physicalIssue).length,
  maps, connections, externalConnections, interpretation: catalog.interpretation };
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
console.log(`${report.mapCount} classic candidate maps, ${parsed.size} exact classic-12, ${connections.length} internal connections, ${report.physicalConnectionIssues} physical issues; libraries: ${report.requiredLibraries.join(', ')}.`);
if (report.unsupportedMaps.length) process.exitCode = 1;
