import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join } from 'node:path';
import { legacyMap } from './native-map.mjs';

const execute = promisify(execFile);
const assets = resolve(process.env.MIR_CLASSIC_ASSETS ?? '.runtime/classic');
const args = process.argv.slice(2);
if (args.some(arg => arg.startsWith('--') && arg !== '--check')) throw new Error('Unknown audit option');
const projects = args.filter(arg => !arg.startsWith('--'));
if (projects.length > 1) throw new Error('Expected one Compose project');
const project = projects[0] ?? 'mir2-web';
if (!/^[a-z0-9][a-z0-9_-]*$/.test(project)) throw new Error('Invalid Compose project');
const sql = `SELECT JSON_OBJECT(
  'items',(SELECT COUNT(*) FROM stditems),
  'skills',(SELECT COUNT(*) FROM magics),
  'monsters',(SELECT COUNT(*) FROM monsters),
  'laterSkills',(SELECT JSON_ARRAYAGG(MagName) FROM magics WHERE MagName REGEXP '英雄|血魄|噬血|逐日|火雨|内功|白日门'),
  'laterItems',(SELECT JSON_ARRAYAGG(Name) FROM stditems WHERE Name REGEXP '英雄|内功|开天|镇天|玄天|倚天|雷霆|星王|天龙')
)`;
const { stdout } = await execute('docker', ['exec', `${project}-db-1`, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --default-character-set=utf8mb4 -uroot --batch --raw --skip-column-names mir2_data -e "$1"', 'sh', sql]);
const database = JSON.parse(stdout);
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const ui = await json(join(assets, 'ui.json'));
const mapAudit = await json('docs/map-audit.json');
const { stdout: mapConfig } = await execute('docker', ['exec', `${project}-engine-1`, 'cat', '/data/server/Mir200/Envir/MapInfo.txt']);
const activatedMapIDs = [...mapConfig.matchAll(/^\s*\[(\S+)\s/gm)].map(match => match[1]);
const reference = await json('docs/reference-176-audit.json');
const world = await json('shared/world.json');
const files = ['shared/world.json', 'shared/classic-storage.json', 'compose.yaml', 'scripts/prepare-classic-world.mjs', 'scripts/prepare-openmir2.mjs', 'scripts/prepare-source-client.mjs', 'scripts/prepare-source-assets.mjs', 'server/SourceClient/Dockerfile', 'server/SourceClient/nginx.conf', 'server/SourceProxy/Dockerfile', 'server/source-client.patch', 'server/source-proxy.patch', 'upstream/mir2-client/apps/web/src/play.ts', 'upstream/mir2-client/apps/web/src/classic-hud.ts', 'upstream/mir2-client/services/web-gateway/GatewaySession.cs', 'server/Engine/Dockerfile', 'server/Engine/run.mjs', 'server/openmir2-linux.patch'];
files.push('server/source-tests.patch', 'scripts/verify-source-deployment.mjs', 'scripts/native-map.mjs');
const contentHashes = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])));
const { stdout: sourceRevision } = await execute('git', ['-C', 'upstream/mir2-client', 'rev-parse', 'HEAD']);
const { stdout: webLabels } = await execute('docker', ['inspect', `${project}-web-1`, '--format', '{{json .Config.Labels}}']);
const labels = JSON.parse(webLabels) ?? {};
let sourceAssets;
try { sourceAssets = await json(join(process.env.MIR_SOURCE_ASSETS ?? '.runtime/source-assets', 'integration.json')); }
catch { sourceAssets = { prepared: false }; }
let nativeMapsMatch;
let mapConversion = { available: false, acceptance: 'failed' };
if (sourceAssets.maps) {
  const paths = sourceAssets.maps.map(map => {
    if (!/^[A-Za-z0-9]+$/.test(map.id)) throw new Error('Invalid source map ID');
    return `/data/server/Mir200/Map/${map.id}.map`;
  });
  const { stdout } = await execute('docker', ['exec', `${project}-engine-1`, 'sha256sum', ...paths]);
  const hashes = Object.fromEntries(stdout.trim().split('\n').map(line => {
    const [hash, file] = line.trim().split(/\s+/);
    return [file.split('/').at(-1).replace(/\.map$/, ''), hash];
  }));
  nativeMapsMatch = sourceAssets.maps.every(map => hashes[map.id] === map.sourceSha256);
  const raw = await readFile(join(assets, 'server-maps/0.map'));
  const lock = await json('shared/classic-assets.lock.json');
  const pinned = lock.files.find(entry => entry.file === 'server-maps/0.map');
  const blob = createHash('sha1').update(`blob ${raw.length}\0`).update(raw).digest('hex');
  if (!pinned || raw.length !== pinned.bytes || blob !== pinned.sha) throw new Error('Unpinned source map in conversion audit');
  if (!raw.subarray(0, 4).equals(Buffer.from([1, 0, 67, 35]))) throw new Error('Unexpected source map layout');
  const converted = legacyMap(raw);
  const convertedHash = createHash('sha256').update(converted).digest('hex');
  const width = raw.readUInt16LE(4), height = raw.readUInt16LE(6);
  const frontLibraries = {}, lostExamples = [], missingMiddle = new Map();
  const missingIndices = new Set(sourceAssets.missingMapReferences?.find(entry => entry.library === 'SmTiles')?.indices ?? []);
  let lostFrontLibraryCells = 0, missingMiddleCells = 0;
  for (let cell = 0; cell < width * height; cell++) {
    const from = 8 + cell * 26, to = 52 + cell * 12;
    const x = Math.floor(cell / height), y = cell % height;
    const library = raw.readInt16LE(from + 10), index = (raw.readUInt16LE(from + 12) & 0x7fff) - 1;
    if (index >= 0 && index < 0x7eff) {
      frontLibraries[library] = (frontLibraries[library] ?? 0) + 1;
      if (library >= 2 && converted[to + 10] !== library - 2) {
        lostFrontLibraryCells++;
        if (lostExamples.length < 8 && x > 0) lostExamples.push({ x, y, sourceLibrary: library, index, convertedFileIndex: converted[to + 10] });
      }
    }
    const middle = (raw.readUInt16LE(from + 8) & 0x7fff) - 1;
    if (missingIndices.has(middle)) {
      missingMiddleCells++;
      const entry = missingMiddle.get(middle) ?? { index: middle, cells: [] };
      entry.cells.push({ x, y, sourceLibrary: raw.readInt16LE(from + 6), sourceImage: raw.readInt16LE(from + 8) });
      missingMiddle.set(middle, entry);
    }
  }
  const matchesPreparedMap = sourceAssets.maps.find(map => map.id === '0')?.sourceSha256 === convertedHash;
  const matchesDeployedMap = hashes['0'] === convertedHash;
  mapConversion = {
    available: true, acceptance: lostFrontLibraryCells || missingMiddleCells || !matchesPreparedMap || !matchesDeployedMap ? 'failed' : 'passed',
    sourceRepository: lock.repository, sourceRevision: lock.revision,
    sourceSha256: createHash('sha256').update(raw).digest('hex'), convertedSha256: convertedHash,
    matchesPreparedMap, matchesDeployedMap,
    dimensions: { width, height }, frontLibraries, lostFrontLibraryCells, lostExamples,
    missingMiddleCells, missingMiddleReferences: [...missingMiddle.values()],
    parserReference: 'Suprcode/Crystal@0e315fe327192afe52c3d7357ddd1f5b7e26c5b8 Client/MirObjects/MapCode.cs LoadMapType100',
    interpretation: 'The conversion discards non-default front library indices. Matching collision cells and native map hashes do not prove visual fidelity. The unresolved middle references also exist in the pinned source map; no parsing defect is established for those references.'
  };
}
const frameIndices = [1, 3, 4, 6, 7, 60, 63, 65, 73, 370, 376, 377, 383, 384, 385, 392, 393];
const frames = Object.fromEntries(frameIndices.map(index => {
  const frame = ui.frames[`ui:ClassicPrguse:${index}`];
  if (!frame) throw new Error(`Missing original UI frame ${index}`);
  return [index, { width: frame.w, height: frame.h }];
}));
const report = {
  checkedAt: new Date().toISOString(), project, target: '2003 Chinese 1.76',
  acceptance: 'failed', goalComplete: false, contentHashes,
  clientImplementation: {
    repository: 'leiniaozl229/mir2', revision: sourceRevision.trim(),
    default: 'existing Pixi H5 source plus its WebSocket/TCP proxy',
    deployedSource: labels['org.opencontainers.image.source'] ?? null,
    deployedRevision: labels['org.opencontainers.image.revision'] ?? null,
    patches: ['server/source-client.patch', 'server/source-proxy.patch'],
    sourceAssets, nativeMapsMatch, mapConversion
  },
  world: { profile: world.profile, activatedMapIDs, enabledMaps: mapAudit.maps, installedMapIDsMatchCollisionAudit: JSON.stringify(activatedMapIDs.slice().sort()) === JSON.stringify(mapAudit.maps.map(map => map.id).sort()), connections: mapAudit.connections, scope: mapAudit.scope },
  database,
  clientArchive: { file: ui.client176.archive, sha256: ui.client176.sha256, provenance: ui.client176.provenance, officialVersionAuthenticated: false, rawArchiveAvailableHere: false },
  originalFrameDimensions: frames,
  referenceCandidate: { repository: reference.repository, revision: reference.revision, tableCounts: reference.tableCounts, directImportAccepted: reference.directImportAccepted, laterSkills: reference.laterSkills, laterItems: reference.laterItems },
  remainingRequirements: [
    'Complete classic world, entrances and spawn tables verified against the chosen version',
    'Version-specific item, monster, skill, drop and NPC data without later content',
    'Complete three-job skill actions and effects, original login transitions and remaining client interactions',
    'Warehouse capacity and failure regressions, trade, groups, guilds and siege browser workflows',
    'Matched full client archive and historical gameplay reference for fidelity comparison',
    'Preserved map layer library indices and matching graphics libraries, with unresolved source references accounted for'
  ],
  interpretation: 'Basic gameplay and original UI frames do not prove full 1.76 fidelity. Later data presence does not by itself prove player reachability.'
};
await writeFile('docs/version-audit.json', JSON.stringify(report, null, 2) + '\n');
console.log(`1.76 acceptance: FAILED; ${mapAudit.maps.length} maps, ${database.skills} mixed-version skills. See docs/version-audit.json.`);
if (process.argv.includes('--check')) process.exitCode = 1;
