import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: 'inherit' });
run('git', ['submodule', 'update', '--init', '--recursive']);
run('node', ['scripts/prepare-openmir2.mjs']);
run('node', ['scripts/fetch-classic.mjs']);
run('node', ['scripts/fetch-native-map-libraries.mjs']);
run('node', ['scripts/fetch-server-data.mjs', '.runtime/mirserver-source']);
run('node', ['scripts/prepare-classic-world.mjs', '.runtime/mirserver-source', '.runtime/classic', '.runtime/classic-profile']);
run('python3', ['scripts/import-map-assets.py'], join(root, 'upstream/mir2-client'));
run('node', ['scripts/prepare-source-assets.mjs', ...process.argv.slice(2)]);
