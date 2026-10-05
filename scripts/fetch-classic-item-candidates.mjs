import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const pins = JSON.parse(await readFile('shared/classic-item-sources.json'));
for (const pin of pins.tables) {
  let raw;
  try { raw = await readFile(pin.path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!raw) {
    const url = `https://raw.githubusercontent.com/${pin.repository}/${pin.revision}/${pin.file}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200, url);
    raw = Buffer.from(await response.arrayBuffer());
  }
  assert.equal(createHash('sha256').update(raw).digest('hex'), pin.sha256, `${pin.repository} item table SHA-256`);
  assert.equal(createHash('sha1').update(`blob ${raw.length}\0`).update(raw).digest('hex'), pin.gitBlob, `${pin.repository} item table Git blob`);
  await mkdir(dirname(pin.path), { recursive: true });
  await writeFile(pin.path, raw);
  console.log(`${pin.repository}@${pin.revision}: ${raw.length} bytes verified; candidate only, no import.`);
}
