import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve('.runtime/openmir2');
await mkdir(output + '/sql', { recursive: true });
try { await readFile(output + '/database.env'); }
catch {
  const password = randomBytes(32).toString('hex');
  await writeFile(output + '/database.env', `MYSQL_ROOT_PASSWORD=${password}\nMIR_DB_PASSWORD=${password}\n`, { mode: 0o600 });
}
for (const [index, name] of ['mir2_account', 'mir2_db', 'mir2_data'].entries()) {
  const original = await readFile(`upstream/openmir2/sql/${name}.sql`, 'utf8');
  // The pinned upstream dumps put each data INSERT on one complete line.
  const sql = name === 'mir2_data' ? original : original.split('\n').filter(line => !/^INSERT INTO /i.test(line)).join('\n');
  if (name !== 'mir2_data' && /\bINSERT\s+INTO\b/i.test(sql)) throw new Error(`Unexpected account data in ${name} schema`);
  await writeFile(`${output}/sql/0${index}-${name}.sql`, `CREATE DATABASE IF NOT EXISTS ${name} CHARACTER SET utf8mb4;\nUSE ${name};\n${sql}`);
}
console.log('Prepared isolated OpenMir2 database schemas without upstream accounts or characters.');
