import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const width = 56, height = 44;
const tiles = [], objects = [], blocked = [];
const noise = (x, y) => ((x * 73856093 ^ y * 19349663) >>> 0) % 100;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const town = x >= 18 && x <= 34 && y >= 16 && y <= 30;
    const road = (x >= 25 && x <= 27) || (y >= 23 && y <= 25);
    const riverX = 42 + Math.round(Math.sin(y / 5) * 2);
    const water = Math.abs(x - riverX) <= 1 && !(y >= 23 && y <= 25);
    const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
    const tree = !town && !road && !water && noise(x, y) < 14;
    const rock = !town && !road && !water && !tree && noise(x, y) > 95;
    tiles.push(water ? 'water' : road ? (x >= 40 ? 'bridge' : 'path') : town ? 'stone' : 'grass');
    if (edge || water || tree || rock) blocked.push([x, y]);
    if (tree) objects.push({ x, y, kind: 'tree', variant: noise(x + 2, y) % 2 });
    else if (rock) objects.push({ x, y, kind: 'rock', variant: 0 });
    else if (!town && !road && !water && noise(x, y) % 7 === 0) objects.push({ x, y, kind: 'flower', variant: noise(x, y) % 3 });
  }
}
for (const [x, y, kind] of [[20, 18, 'house'], [31, 18, 'house'], [20, 28, 'house'], [31, 28, 'house'], [24, 20, 'well']]) {
  objects.push({ x, y, kind, variant: 0 });
  if (kind === 'house') {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -2; dy <= 0; dy++) blocked.push([x + dx, y + dy]);
  } else blocked.push([x, y]);
}
const world = { version: 1, name: '青石镇', fileName: 'Qingshi', width, height, spawn: { x: 26, y: 24 }, tiles, objects, blocked };
await mkdir(`${root}/shared`, { recursive: true });
await writeFile(`${root}/shared/world.json`, `${JSON.stringify(world)}\n`);
console.log(`World: ${width}x${height}, ${blocked.length} blocked cells`);
