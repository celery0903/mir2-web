import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, stat, rename, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join } from 'node:path';

const lock = JSON.parse(await readFile(new URL('../shared/archived-176-client.lock.json', import.meta.url)));
const destination = resolve(process.argv[2] ?? '.runtime/original-client-research');
const execute = promisify(execFile);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
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
const iso = join(destination, lock.iso.file);
if (!await valid(iso, lock.iso)) {
  const temporary = iso + '.part';
  try {
    const response = await fetch(lock.iso.url, { signal: AbortSignal.timeout(600000) });
    assert.ok(response.ok && response.body, `Archive download: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
    assert.ok(await valid(temporary, lock.iso), 'Archive checksum mismatch');
    await rename(temporary, iso);
  } finally { await rm(temporary, { force: true }); }
}
const installerDir = join(destination, 'installer');
await execute('7z', ['x', '-y', `-o${installerDir}`, iso, lock.installer.file]);
const installer = join(installerDir, lock.installer.file);
assert.ok(await valid(installer, lock.installer), 'Installer checksum mismatch');
const bytes = await readFile(installer), cabinets = join(destination, 'cabinets');
await mkdir(cabinets, { recursive: true });
// These are exact embedded file ranges for the pinned installer, not guessed CAB boundaries.
for (const entry of lock.embeddedFiles) {
  assert.ok(entry.offset >= 0 && entry.offset + entry.bytes <= bytes.length);
  const contents = bytes.subarray(entry.offset, entry.offset + entry.bytes);
  if (entry.sha256) assert.equal(digest(contents), entry.sha256, `Embedded checksum mismatch: ${entry.file}`);
  await writeFile(join(cabinets, entry.file), contents);
}
const setup = new TextDecoder('gbk').decode(await readFile(join(cabinets, 'setup.ini')));
assert.ok(setup.includes(`AppName=${lock.installer.appName}`) && setup.includes(`CompanyName=${lock.installer.companyName}`));
const extraction = await execute('unshield', ['-d', join(destination, 'extracted'), 'x', join(cabinets, 'data1.cab')], { timeout: 120000, maxBuffer: 1024 * 1024 });
for (const entry of lock.clientFiles) assert.ok(await valid(join(destination, 'extracted/App_Executables', entry.file), entry), `Extracted client checksum mismatch: ${entry.file}`);
await writeFile(join(destination, 'extraction-evidence.json'), JSON.stringify({ checkedAt: new Date().toISOString(), lock,
  installerExecuted: false, extractionTool: (await execute('unshield', ['-V'])).stdout.trim(), stdout: extraction.stdout,
  verifiedClientFiles: lock.clientFiles,
  authenticated2003Client: false, full176Acceptance: false }, null, 2) + '\n');
console.log(`Verified and extracted ${lock.installer.appName}; this is an upgrade package, not a complete original client.`);
