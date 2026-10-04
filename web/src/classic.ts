import world from '../../shared/world.json';

export type Frame = { atlas: number; x: number; y: number; w: number; h: number; offsetX: number; offsetY: number };
export type Action = 'stand' | 'walk' | 'run' | 'attack' | 'cast' | 'harvest' | 'hit' | 'die';
export type ActorFrames = Partial<Record<Action, string[][]>> & { actionFrameMs: Partial<Record<Action, number>> };
export type TerrainRef = { key: string; drawX: number; drawY: number; floor: boolean; render?: boolean; blend?: boolean; animationKeys?: string[] };
export type Cell = { x: number; y: number; blocked: boolean; back?: TerrainRef; middle?: TerrainRef; front?: TerrainRef };
export type Chunk = { x: number; y: number; cells: Cell[] };
type Atlas = { file: string; width: number; height: number };
type MapData = { id: string; name: string; width: number; height: number; chunks: { x: number; y: number; width: number; height: number; file: string; atlases: number[] }[] };
type Manifest = { frames: Record<string, Frame>; actors: Record<string, ActorFrames>; atlases: Atlas[]; map: MapData; spellFireBall: { cast: string[]; hit: string[]; projectile: string[][] } };

const json = async <T>(file: string): Promise<T> => {
  const response = await fetch(world.assets + file);
  if (!response.ok) throw new Error(`Classic resource ${file}: HTTP ${response.status}`);
  return response.json();
};
export const manifest = await json<Manifest>('manifest.json');
export let collision = await json<{ rows: string[] }>('collision.json');
export let currentMap = manifest.map;
const maps = new Map<string, Promise<{ map: MapData; collision: { rows: string[] } }>>();
let mapRequest = 0;
maps.set('0', Promise.resolve({ map: currentMap, collision }));
export async function loadMap(id: string) {
  const generation = ++mapRequest;
  if (!maps.has(id)) maps.set(id, (async () => {
    if (!/^\d{1,4}$/.test(id)) throw new Error('Invalid map ID');
    const extra = await json<Pick<Manifest, 'frames' | 'atlases' | 'map'>>(`maps/${id}/manifest.json`);
    const offset = manifest.atlases.length;
    manifest.atlases.push(...extra.atlases);
    for (const [key, frame] of Object.entries(extra.frames)) manifest.frames[key] = { ...frame, atlas: frame.atlas + offset };
    return { map: extra.map, collision: await json<{ rows: string[] }>(`maps/${id}/collision.json`) };
  })());
  const loaded = await maps.get(id)!;
  if (generation === mapRequest) { currentMap = loaded.map; collision = loaded.collision; }
}
const additions = await Promise.all(['classic-player', 'classic-wildlife', 'classic-npc', 'classic-chicken', 'healing'].map(name => json<Partial<Manifest> & Pick<Manifest, 'frames' | 'atlases'>>(`actors/${name}.json`)));
for (const extra of additions) {
  const offset = manifest.atlases.length;
  manifest.atlases.push(...extra.atlases);
  for (const [key, frame] of Object.entries(extra.frames)) manifest.frames[key] = { ...frame, atlas: frame.atlas + offset };
  Object.assign(manifest.actors, extra.actors);
}
const ui = await json<{ frames: Record<string, Frame>; atlases: Atlas[]; hudHitRows: string[] }>('ui.json');
export const classicLayout = { width: 800, height: 600, hudTop: 349, mapBottom: 469 };
export function hudBlocksWorld(x: number, y: number) {
  if (x < 0 || x >= 800 || y < 0 || y >= 469) return true;
  return y >= 349 && ui.hudHitRows[Math.floor(y) - 349]?.[Math.floor(x)] === '1';
}
const images = await Promise.all(ui.atlases.map(async atlas => {
  const image = new Image();
  image.src = world.assets + atlas.file;
  await image.decode();
  return image;
}));
const icons = new Map<string, string>();
const portraitManifest = await json<{ portraits: Record<string, { w: number; h: number }> }>('auth-web/manifest.json');
const portraits = new Map<string, string>();
await Promise.all(Object.entries(portraitManifest.portraits).map(async ([key, size]) => {
  const image = new Image(); image.src = world.assets + `auth-web/${key}.png`; await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = size.w; canvas.height = size.h;
  canvas.getContext('2d')!.drawImage(image, 0, 0, size.w, size.h, 0, 0, size.w, size.h);
  portraits.set(key, canvas.toDataURL());
}));
export const portrait = (job: number, gender: number) => portraits.get(`portrait-${job}-${gender}`) ?? '';
export function portraitSprite(job: number, gender: number, slot = 0, frozen = false) {
  const key = `portrait-${job}-${gender}`;
  const size = portraitManifest.portraits[key];
  const [left, top] = [[71, 52], [65, 55], [77, 46], [141, 83], [85, 63], [141, 83]][job * 2 + gender];
  const [dx, dy] = frozen && gender === 1 ? job === 1 ? [30, 14] : job === 2 ? [23, 20] : [0, 0] : [0, 0];
  return { ...size, left: left + slot * 340 + dx, top: top + slot * 2 + dy, source: world.assets + `auth-web/${key}.png` };
}
export function nativeFrame(group: string, index: number) {
  const key = `ui:${group}:${index}`;
  if (icons.has(key)) return icons.get(key)!;
  const frame = ui.frames[key];
  if (!frame) return '';
  const canvas = document.createElement('canvas');
  canvas.width = frame.w; canvas.height = frame.h;
  canvas.getContext('2d')!.drawImage(images[frame.atlas], frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
  const url = canvas.toDataURL();
  icons.set(key, url);
  return url;
}
export function nativeFrameSize(group: string, index: number) {
  const frame = ui.frames[`ui:${group}:${index}`];
  return frame && { width: frame.w, height: frame.h, offsetX: frame.offsetX, offsetY: frame.offsetY };
}
export function itemImage(index: number, group = 'Items') {
  const url = nativeFrame(group, index);
  return url ? `<img class="native-item" src="${url}" alt="">` : '';
}
export const walkable = (x: number, y: number) => x >= 0 && y >= 0 && x < currentMap.width && y < currentMap.height && collision.rows[y]?.[x] === '0';

// Keep path searches local to the visible destination instead of cloning 490,000 nodes.
export function localGrid(start: { x: number; y: number }, goal: { x: number; y: number }, margin = 16) {
  const left = Math.max(0, Math.min(start.x, goal.x) - margin), top = Math.max(0, Math.min(start.y, goal.y) - margin);
  const right = Math.min(currentMap.width - 1, Math.max(start.x, goal.x) + margin), bottom = Math.min(currentMap.height - 1, Math.max(start.y, goal.y) + margin);
  const matrix = Array.from({ length: bottom - top + 1 }, (_, y) => Array.from({ length: right - left + 1 }, (_, x) => walkable(left + x, top + y) ? 0 : 1));
  return { left, top, matrix };
}
