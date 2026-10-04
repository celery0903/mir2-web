import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';
import { legacyMap, legacyTileRemap } from './native-map.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const source = join(root, 'upstream/mir2-client');
const classic = resolve(process.env.MIR_CLASSIC_ASSETS ?? join(root, '.runtime/classic'));
const maps = resolve(process.env.MIR_SOURCE_MAPS ?? join(root, '.runtime/classic-profile/Map'));
const output = resolve(process.env.MIR_SOURCE_ASSETS ?? join(root, '.runtime/source-assets'));
const sourceAssets = join(source, 'assets/web');
const nativeLock = JSON.parse(await readFile(join(root, 'shared/native-world.lock.json')));
const nativeMapIDs = new Set(nativeLock.defaultMapIDs);
const nativeLibraries = resolve(process.env.MIR_NATIVE_MAP_LIBRARIES ?? join(root, '.runtime/wemade-mir2'));
const revision = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (revision !== '77e3ff7506b1ca55cac15df247cb2fcedd69c535') throw new Error('Unexpected source client revision');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const lock = await json(join(root, 'shared/classic-assets.lock.json'));
const verified = new Set();
async function classicFile(file) {
  const entry = lock.files.find(value => value.file === file);
  if (!entry) throw new Error(`Unpinned classic asset: ${file}`);
  const bytes = await readFile(join(classic, file));
  const hash = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if (bytes.length !== entry.bytes || hash !== entry.sha) throw new Error(`Classic asset changed: ${file}`);
  verified.add(file);
  return bytes;
}

await mkdir(output, { recursive: true });
for (const directory of ['actors', 'effects', 'items', 'ui', 'audio']) {
  try { await readFile(join(output, '.copied-' + directory)); }
  catch {
    await cp(join(sourceAssets, directory), join(output, directory), { recursive: true });
    await writeFile(join(output, '.copied-' + directory), revision);
  }
}
const mapReport = [];
const rooms = [];
const bichon = JSON.parse(await classicFile('manifest.json'));
const bichonAdapters = new Map();
const dependencies = { Tiles: new Set(), SmTiles: new Set(), Objects: new Set() };
const mapAuditFile = resolve(process.env.MIR_MAP_AUDIT ?? join(root, '.runtime/classic-profile/audit.json'));
const mapAudit = await json(mapAuditFile);
for (const { id } of mapAudit.maps) {
  const file = join(maps, `${id}.map`);
  execFileSync('python3', [join(source, 'tools/map_tool.py'), 'export', file, '--output', join(output, 'maps', id)], { stdio: 'inherit' });
  const manifest = await json(join(output, 'maps', id, 'map.json'));
  if (manifest.id !== id) throw new Error(`Map ID mismatch: ${id}`);
  if (nativeMapIDs.has(id)) {
    const pin = nativeLock.maps.find(map => map.id === id);
    const raw = await readFile(file);
    if (raw.length !== pin.bytes || digest(raw) !== pin.sha256) throw new Error(`Native map checksum mismatch: ${id}`);
  } else if (id === '0') {
    const sourceMap = await classicFile('server-maps/0.map');
    const raw = await readFile(file);
    if (!legacyMap(sourceMap).equals(raw)) throw new Error('Bichon does not match the pinned map conversion');
    const tileSourceIndices = Object.fromEntries(Object.entries(legacyTileRemap(sourceMap)).map(([sourceImage, nativeImage]) => [nativeImage - 1, Number(sourceImage) - 1]));
    const objectLibraries = {};
    const tileIndices = new Set();
    for (let offset = 52; offset < raw.length; offset += 12) {
      const cell = (offset - 52) / 12, x = Math.floor(cell / manifest.height), y = cell % manifest.height;
      const tileIndex = (raw.readUInt16LE(offset) & 0x7fff) - 1;
      if (x % 2 === 0 && y % 2 === 0 && tileIndex >= 0 && tileIndex < 0x7eff) tileIndices.add(tileIndex);
      const index = (raw.readUInt16LE(offset + 4) & 0x7fff) - 1;
      if (index < 0 || index >= 0x7eff) continue;
      const family = raw[offset + 10] + 2;
      const name = family === 2 ? 'Objects' : `BichonObjects${family}`;
      objectLibraries[raw[offset + 10]] = name;
      const adapter = bichonAdapters.get(name) ?? { family, indices: new Set() };
      const count = Math.max(1, raw[offset + 8] & 127);
      for (let n = 0; n < count; n++) adapter.indices.add(index + n);
      bichonAdapters.set(name, adapter);
    }
    manifest.dependencies.Tiles = [...tileIndices].sort((a, b) => a - b);
    for (const [name, family] of [['Tiles', 0], ['SmTiles', 1]]) bichonAdapters.set(name, { family, indices: new Set(manifest.dependencies[name]) });
    bichonAdapters.get('Tiles').sourceIndices = tileSourceIndices;
    manifest.tileSourceIndices = tileSourceIndices;
    manifest.objectLibraries = objectLibraries;
    manifest.dependencies.Objects = [];
    for (const [name, adapter] of bichonAdapters) manifest.dependencies[name] = [...adapter.indices].sort((a, b) => a - b);
    await writeFile(join(output, 'maps', id, 'map.json'), JSON.stringify(manifest, null, 2) + '\n');
  } else {
    const room = JSON.parse(await classicFile(`maps/${id}/manifest.json`));
    const objectLibraries = {};
    const raw = await readFile(file);
    const references = new Map();
    for (let offset = 52; offset < 52 + manifest.width * manifest.height * 12; offset += 12) {
      const index = (raw.readUInt16LE(offset + 4) & 0x7fff) - 1;
      if (index < 0 || index >= 0x7eff) continue;
      const family = raw[offset + 10] + 2;
      if (!room.frames[`room${id}:${family}:${index}`]) throw new Error(`Missing room frame: ${id}/${family}/${index}`);
      objectLibraries[raw[offset + 10]] = `Room${id}Objects${family - 1}`;
      const indices = references.get(family) ?? new Set();
      const count = Math.max(1, raw[offset + 8] & 127);
      for (let n = 0; n < count; n++) indices.add(index + n);
      references.set(family, indices);
    }
    manifest.objectLibraries = objectLibraries;
    manifest.dependencies.Objects = [];
    for (const [family, indices] of references) manifest.dependencies[objectLibraries[family - 2]] = [...indices].sort((a, b) => a - b);
    await writeFile(join(output, 'maps', id, 'map.json'), JSON.stringify(manifest, null, 2) + '\n');
    rooms.push({ id, room, references, objectLibraries });
  }
  for (const [name, indices] of Object.entries(manifest.dependencies)) {
    if (!dependencies[name]) continue;
    for (const index of indices) dependencies[name].add(index);
  }
  mapReport.push({ id, sourceSha256: manifest.sourceSha256, width: manifest.width, height: manifest.height, ...(manifest.objectLibraries ? { objectLibraries: manifest.objectLibraries } : {}) });
}
const dependencyFile = join(output, 'map-dependencies.json');
await writeFile(dependencyFile, JSON.stringify({ dependencies: Object.fromEntries(Object.entries(dependencies).map(([name, indices]) => [name, [...indices].sort((a, b) => a - b)])) }));
const sourceLock = await json(join(source, 'content/classic-176/asset-sources.json'));
const missingMapReferences = [];
const selectedNativeIDs = mapAudit.maps.filter(map => nativeMapIDs.has(map.id)).map(map => map.id);
if (selectedNativeIDs.length) {
  execFileSync('python3', [join(root, 'scripts/prepare-native-map-assets.py'), '--maps', maps, '--libraries', nativeLibraries, '--output', output, '--ids', ...selectedNativeIDs, '--supplement', dependencyFile], { stdio: 'inherit' });
  const nativeReport = await json(join(output, 'native-world.json'));
  missingMapReferences.push(...nativeReport.missingMapReferences);
  for (const map of nativeReport.maps) Object.assign(mapReport.find(entry => entry.id === map.id), map);
}
for (const name of selectedNativeIDs.length ? [] : Object.keys(dependencies)) {
  if (bichonAdapters.has(name)) continue;
  const entry = sourceLock.files.find(value => value.file.toLowerCase() === `${name}.lib`.toLowerCase());
  const file = join(source, 'assets/raw/crystal-shanda', entry.file);
  const raw = await readFile(file);
  if (raw.length !== entry.bytes || digest(raw) !== entry.sha256) throw new Error(`Map library hash changed: ${name}`);
  execFileSync('python3', [join(source, 'tools/crystal_lib.py'), file, '--map-manifest', dependencyFile, '--layer', name, '--output', join(output, 'libraries', name)], { stdio: 'inherit' });
  const manifest = await json(join(output, 'libraries', name, 'library.json'));
  if (manifest.missing.length) missingMapReferences.push({ library: name, indices: manifest.missing });
}

const imageCache = new Map();
async function atlas(file) {
  if (!imageCache.has(file)) imageCache.set(file, PNG.sync.read(await classicFile(file)));
  return imageCache.get(file);
}
async function frame(destination, index, file, rect) {
  const image = await atlas(file);
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > image.width || rect.y + rect.h > image.height) throw new Error(`Frame outside atlas: ${file}/${index}`);
  const cropped = new PNG({ width: rect.w, height: rect.h });
  PNG.bitblt(image, cropped, rect.x, rect.y, rect.w, rect.h, 0, 0);
  const bytes = PNG.sync.write(cropped), sha256 = digest(bytes);
  const name = `${index}.${sha256.slice(0, 16)}.png`;
  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, name), bytes);
  return { index, file: name, width: rect.w, height: rect.h, offsetX: rect.offsetX ?? 0, offsetY: rect.offsetY ?? 0, sha256 };
}
async function library(destination, frames, extra = {}) {
  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, 'library.json'), JSON.stringify({ schemaVersion: 1, format: 'atlas-adapter', frames, actions: {}, empty: [], missing: [], authenticated2003Client: false, ...extra }, null, 2) + '\n');
}

for (const [name, { family, indices, sourceIndices = {} }] of bichonAdapters) {
  const directory = join(output, 'libraries', name), frames = {}, empty = [], missing = [];
  const references = dependencies[name] ?? indices;
  const emptyFrames = new Set(bichon.emptyFrames);
  const knownMissing = new Set(bichon.missingReferences.map(entry => entry.key));
  for (const index of references) {
    const sourceIndex = sourceIndices[index] ?? index;
    const key = `${family}:${sourceIndex}`, rect = bichon.frames[key];
    if (rect) frames[index] = { ...await frame(directory, index, bichon.atlases[rect.atlas].file, rect), sourceIndex };
    else if (emptyFrames.has(key) && !knownMissing.has(key)) empty.push(index);
    else missing.push(index);
  }
  empty.sort((a, b) => a - b); missing.sort((a, b) => a - b);
  if (missing.length) missingMapReferences.push({ library: name, indices: missing });
  await library(directory, frames, { empty, missing, sourceManifest: 'manifest.json', sourceLibrary: family, sourceIndices });
}
if (missingMapReferences.length && !process.argv.includes('--allow-missing-references')) {
  throw new Error(`Source maps contain unresolved library references: ${JSON.stringify(missingMapReferences)}. Use --allow-missing-references only for the documented incomplete integration.`);
}

for (const { id, room, references, objectLibraries } of rooms) {
  for (const [family, indices] of references) {
    const directory = join(output, 'libraries', objectLibraries[family - 2]), frames = {};
    for (const index of indices) {
      const rect = room.frames[`room${id}:${family}:${index}`];
      if (!rect) throw new Error(`Missing animated room frame: ${id}/${family}/${index}`);
      frames[index] = await frame(directory, index, room.atlases[rect.atlas].file, rect);
    }
    await library(directory, frames, { sourceManifest: `maps/${id}/manifest.json`, provenance: room.sources });
  }
}

const ui = JSON.parse(await classicFile('ui.json'));
const familyNames = { ClassicPrguse: 'prguse', ClassicPrguse2: 'prguse2', Items: 'items', Stateitem: 'stateitem', MagIcon: 'magic-icons' };
const families = new Map();
for (const [key, rect] of Object.entries(ui.frames)) {
  const [, name, number] = key.split(':'), family = familyNames[name];
  if (!family) continue;
  const frames = families.get(family) ?? {};
  frames[number] = await frame(join(output, 'ui-national', family), Number(number), ui.atlases[rect.atlas].file, rect);
  families.set(family, frames);
}
for (const [family, frames] of families) await library(join(output, 'ui-national', family), frames, { provenance: ui.client176 });

const auth = JSON.parse(await classicFile('auth-web/manifest.json'));
const chrsel = {}, chrDirectory = join(output, 'ui-national/chrsel');
const loginImage = await atlas('auth-web/login.png');
chrsel[22] = await frame(chrDirectory, 22, 'auth-web/login.png', { x: 0, y: 0, w: loginImage.width, h: loginImage.height });
for (const [job, sex, index] of [[0, 0, 40], [1, 0, 80], [2, 0, 120], [0, 1, 160], [1, 1, 200], [2, 1, 240]]) {
  const name = `portrait-${job}-${sex}`, size = auth.portraits[name];
  chrsel[index] = await frame(chrDirectory, index, `auth-web/${name}.png`, { x: 0, y: 0, w: size.w, h: size.h });
}
await library(chrDirectory, chrsel, { sourceManifest: 'auth-web/manifest.json', provenance: ui.client176 });
const minimapFile = 'webui/bichon-map.png', minimap = await atlas(minimapFile);
const mmapDirectory = join(output, 'ui-national/mmap');
await library(mmapDirectory, { 100: await frame(mmapDirectory, 100, minimapFile, { x: 0, y: 0, w: minimap.width, h: minimap.height }) });

const actorFiles = ['manifest.json', 'actors/classic-chicken.json', 'actors/classic-wildlife.json'];
const actions = [['stand', '0'], ['walk', '1'], ['attack', '9'], ['hit', '18'], ['die', '21']];
const actors = [];
for (const file of actorFiles) {
  const data = JSON.parse(await classicFile(file));
  for (const [key, actor] of Object.entries(data.actors ?? {})) {
    const match = /^monster(\d+)$/.exec(key);
    if (!match || Number(match[1]) < 3 || Number(match[1]) > 12) continue;
    const directory = join(output, 'actors', `BichonMonster${match[1]}`), frames = {}, definitions = {};
    let next = 0;
    for (const [action, code] of actions) {
      const directions = actor[action];
      if (!directions?.length) continue;
      const count = directions[0].length;
      if (directions.length !== 8 || directions.some(value => value.length !== count) || count === 0) throw new Error(`Unsupported action layout: ${key}/${action}`);
      definitions[code] = { start: next, count, skip: 0, interval: actor.actionFrameMs?.[action] ?? 100 };
      for (const direction of directions) for (const id of direction) {
        const rect = data.frames[id];
        if (!rect) throw new Error(`Missing actor frame: ${key}/${id}`);
        frames[next] = await frame(directory, next, data.atlases[rect.atlas].file, rect);
        next++;
      }
      if (action === 'die') definitions['22'] = { start: definitions[code].start + count - 1, count: 1, skip: count - 1, interval: 1000 };
    }
    await library(directory, frames, { actions: definitions, sourceManifest: file, sourceActor: key });
    actors.push({ source: key, frames: next });
  }
}
if (new Set(actors.map(value => value.source)).size !== 10) throw new Error('Incomplete Bichon actor conversion');
const npc = JSON.parse(await classicFile('actors/classic-npc.json'));
const npcDirectory = join(output, 'actors/NPC00');
const npcLibrary = await json(join(npcDirectory, 'library.json'));
const adaptedNpcShapes = [];
for (const [key, actor] of Object.entries(npc.actors)) {
  const match = /^npc(\d+)$/.exec(key);
  if (!match) continue;
  const id = actor.stand[0][0], rect = npc.frames[id], index = Number(match[1]);
  npcLibrary.frames[index] = await frame(npcDirectory, index, npc.atlases[rect.atlas].file, rect);
  adaptedNpcShapes.push(index);
}
await writeFile(join(npcDirectory, 'library.json'), JSON.stringify({ ...npcLibrary, adaptedNpcShapes, adaptedSourceManifest: 'actors/classic-npc.json', authenticated2003Client: false }, null, 2) + '\n');
const report = { checkedAt: new Date().toISOString(), sourceRevision: revision, authenticated2003Client: false, mapResourceAcceptance: missingMapReferences.length ? 'failed' : 'passed', missingMapReferences, maps: mapReport, classicSource: { repository: lock.repository, revision: lock.revision, verifiedFiles: [...verified].sort() }, uiFamilies: Object.fromEntries([...families].map(([name, frames]) => [name, Object.keys(frames).length])), actors };
for (const map of mapReport) {
  const manifest = await json(join(output, 'maps', map.id, 'map.json'));
  const raw = await readFile(join(maps, `${map.id}.map`));
  const rebuilt = Buffer.alloc(raw.length);
  raw.copy(rebuilt, 0, 0, 52);
  const covered = new Uint8Array(manifest.width * manifest.height);
  for (const chunk of manifest.chunks) {
    const bytes = await readFile(join(output, 'maps', map.id, chunk.file));
    if (bytes.length !== chunk.width * chunk.height * 12 || digest(bytes) !== chunk.sha256) throw new Error(`Invalid map chunk: ${map.id}/${chunk.file}`);
    for (let x = 0; x < chunk.width; x++) {
      const start = (chunk.x + x) * manifest.height + chunk.y;
      for (let y = 0; y < chunk.height; y++) {
        if (covered[start + y]) throw new Error(`Overlapping map chunks: ${map.id}`);
        covered[start + y] = 1;
      }
      bytes.copy(rebuilt, 52 + start * 12, x * chunk.height * 12, (x + 1) * chunk.height * 12);
    }
  }
  if (covered.some(value => !value) || !rebuilt.equals(raw)) throw new Error(`Browser/native map cells differ: ${map.id}`);
  map.browserCellsMatchNative = true;
  const audit = mapAudit.maps.find(entry => entry.id === map.id);
  audit.collisionMismatches = 0;
  audit.browserCollisionVerification = 'all exported cells match native bytes';
}
await writeFile(mapAuditFile, JSON.stringify(mapAudit, null, 2) + '\n');
execFileSync('python3', [join(root, 'scripts/prepare-source-magic.py'), output], { stdio: 'inherit' });
report.magicEffects = await json(join(output, 'effects/integration.json'));
await writeFile(join(output, 'integration.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`Prepared ${mapReport.length} matched maps, ${actors.length} actor libraries and ${families.size + 2} UI families in ${basename(output)}.`);
