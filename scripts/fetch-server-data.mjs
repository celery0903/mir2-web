import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const lock = JSON.parse(await readFile(new URL('../shared/server-data.lock.json', import.meta.url)));
const output = resolve(process.argv[2] ?? '.runtime/server-source');
const response = await fetch(`https://codeload.github.com/${lock.repository}/tar.gz/${lock.revision}`, { signal: AbortSignal.timeout(180000) });
if (!response.ok) throw new Error(`Server data download: HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash('sha256').update(bytes).digest('hex') !== lock.sha256) throw new Error('Server data checksum mismatch');
await mkdir(output, { recursive: true });
const archive = output + '/source.tar.gz';
await writeFile(archive, bytes);
execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', output]);
await rm(archive);
console.log(`Verified server data: ${lock.repository}@${lock.revision}`);
