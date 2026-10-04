import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const repository = 'fq393/mir2-web';
const revision = '7e5782118c78defb42d8ffb55ca3a3de199e90a6';
const prefix = 'client/assets/resources/mir/';
const lockFile = new URL('../shared/classic-assets.lock.json', import.meta.url);
const gitHash = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

if (process.argv.includes('--lock')) {
  const response = await fetch(`https://api.github.com/repos/${repository}/git/trees/${revision}?recursive=1`);
  if (!response.ok) throw new Error(`Asset tree HTTP ${response.status}`);
  const tree = await response.json();
  const files = tree.tree.filter(file => file.type === 'blob' && (
    file.path.startsWith(prefix) && !file.path.endsWith('.meta') ||
    /^assets\/server-maps\/\d+\.map$/.test(file.path) ||
    /^assets\/auth-web\/(login\.png|door\.png|portrait-\d-\d\.png|manifest\.json)$/.test(file.path)
  )).map(file => ({ path: file.path, file: file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path.replace('assets/', ''), bytes: file.size, sha: file.sha }));
  await writeFile(lockFile, JSON.stringify({ repository, revision, files }, null, 2) + '\n');
  console.log(`Pinned ${files.length} classic resource files.`);
} else {
  const lock = JSON.parse(await readFile(lockFile));
  const destination = resolve(process.argv[2] ?? '.runtime/classic');
  let next = 0, complete = 0;
  await Promise.all(Array.from({ length: 10 }, async () => {
    while (next < lock.files.length) {
      const entry = lock.files[next++];
      const target = resolve(destination, entry.file);
      if (!target.startsWith(destination + '/')) throw new Error('Invalid asset path');
      try {
        const cached = await readFile(target);
        if (cached.length === entry.bytes && gitHash(cached) === entry.sha) { complete++; continue; }
      } catch {}
      let bytes;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(`https://raw.githubusercontent.com/${lock.repository}/${lock.revision}/${entry.path}`, { signal: AbortSignal.timeout(60000) });
          if (!response.ok) throw new Error(`HTTP ${response.status}: ${entry.file}`);
          bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length !== entry.bytes || gitHash(bytes) !== entry.sha) throw new Error(`Asset checksum mismatch: ${entry.file}`);
          break;
        } catch (error) { if (attempt === 2) throw error; }
      }
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target + '.part', bytes);
      await rename(target + '.part', target);
      if (++complete % 100 === 0) console.log(`Classic resources: ${complete}/${lock.files.length}`);
    }
  }));
  console.log(`Classic resources verified: ${complete} files in ${destination}`);
}
