import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join } from 'node:path';

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
const files = ['shared/world.json', 'shared/classic-storage.json', 'scripts/prepare-classic-world.mjs', 'scripts/prepare-openmir2.mjs', 'web/src/main.ts', 'web/src/style.css', 'web/src/game.ts', 'web/src/classic.ts', 'web/src/client.ts', 'web/src/audio.ts', 'server/Engine/Dockerfile', 'server/Engine/run.mjs', 'server/WebGateway/GatewaySession.cs', 'server/WebGateway/Program.cs', 'server/openmir2-linux.patch'];
const contentHashes = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])));
const frameIndices = [1, 3, 4, 6, 7, 60, 63, 65, 73, 370, 376, 377, 383, 384, 385, 392, 393];
const frames = Object.fromEntries(frameIndices.map(index => {
  const frame = ui.frames[`ui:ClassicPrguse:${index}`];
  if (!frame) throw new Error(`Missing original UI frame ${index}`);
  return [index, { width: frame.w, height: frame.h }];
}));
const report = {
  checkedAt: new Date().toISOString(), project, target: '2003 Chinese 1.76',
  acceptance: 'failed', goalComplete: false, contentHashes,
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
    'Matched full client archive and historical gameplay reference for fidelity comparison'
  ],
  interpretation: 'Basic gameplay and original UI frames do not prove full 1.76 fidelity. Later data presence does not by itself prove player reachability.'
};
await writeFile('docs/version-audit.json', JSON.stringify(report, null, 2) + '\n');
console.log(`1.76 acceptance: FAILED; ${mapAudit.maps.length} maps, ${database.skills} mixed-version skills. See docs/version-audit.json.`);
if (process.argv.includes('--check')) process.exitCode = 1;
