import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve, join } from 'node:path';

const lock = JSON.parse(await readFile(new URL('../shared/native-world.lock.json', import.meta.url)));
const destination = resolve(process.argv[2] ?? '.runtime/wemade-mir2');
await mkdir(destination, { recursive: true });

async function valid(file, entry) {
  try {
    if ((await stat(file)).size !== entry.bytes) return false;
    const hash = createHash('sha256');
    for await (const bytes of createReadStream(file)) hash.update(bytes);
    return hash.digest('hex') === entry.sha256;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

for (const entry of lock.libraries) {
  if (!/^[A-Za-z0-9]+\.Lib$/.test(entry.file)) throw new Error('Invalid map library path');
  const file = join(destination, entry.file);
  if (!await valid(file, entry)) {
    const temporary = file + '.part';
    try {
      const response = await fetch(lock.libraryBaseURL + entry.file, { signal: AbortSignal.timeout(600000) });
      if (!response.ok || !response.body) throw new Error(`Map library download: HTTP ${response.status}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
      if (!await valid(temporary, entry)) throw new Error(`Map library checksum mismatch: ${entry.file}`);
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  console.log(`Verified WemadeMir2/${entry.file}`);
}
