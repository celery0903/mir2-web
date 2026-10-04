import { cp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';

if (process.argv.includes('--health')) {
  const response = await fetch('http://127.0.0.1:8081/health', { signal: AbortSignal.timeout(2000) });
  process.exit(response.ok ? 0 : 1);
}

const root = process.env.MIR_ENGINE_DATA ?? '/data/server';
const services = [['LoginSrv', 'LoginSrv'], ['DBSrv', 'DBServer'], ['GameSrv', 'Mir200'], ['LoginGate', 'LoginGate'], ['SelGate', 'SelGate'], ['GameGate', 'RunGate']];
const children = new Map();
let ready = false, stopping = false, saveAcknowledged = false;
const text = bytes => new TextDecoder(bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 239 && bytes[1] === 187 ? 'utf-8' : 'gbk').decode(bytes).replace(/^\uFEFF/, '');
const bomWrite = (file, value) => writeFile(file, '\uFEFF' + value);

async function config(directory, file, sections, seed) {
  const values = new Map();
  let section = '';
  if (seed) {
    const source = text(await readFile(seed));
    for (const line of source.split(/\r?\n/)) {
      if (/^\[.*\]$/.test(line.trim())) { section = line.trim().slice(1, -1); values.set(section, new Map()); }
      else if (line.includes('=') && section && !/^\s*;/.test(line)) {
        const at = line.indexOf('=');
        values.get(section).set(line.slice(0, at).trim(), line.slice(at + 1).trim().replaceAll('\\', '/'));
      }
    }
  }
  for (const [name, entries] of Object.entries(sections)) {
    if (!values.has(name)) values.set(name, new Map());
    for (const [key, value] of Object.entries(entries)) values.get(name).set(key, String(value));
  }
  await bomWrite(join(root, directory, file), [...values].map(([name, entries]) => `[${name}]\n${[...entries].map(([key, value]) => `${key}=${value}`).join('\n')}\n`).join('\n'));
}

async function normalize(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await normalize(file);
    else if (/\.(txt|conf|ini)$/i.test(file)) await bomWrite(file, text(await readFile(file)));
  }
}

async function listeners() {
  const tables = await Promise.all(['/proc/net/tcp', '/proc/net/tcp6'].map(file => readFile(file, 'utf8')));
  const ports = new Set();
  for (const line of tables.join('\n').split('\n')) {
    const fields = line.trim().split(/\s+/);
    if (fields[3] === '0A') ports.add(parseInt(fields[1].split(':').at(-1), 16));
  }
  return ports;
}

async function waitPorts(ports) {
  for (let retry = 0; retry < 180; retry++) {
    if ([...children.values()].some(child => child.exitCode !== null)) throw new Error('An OpenMir2 service exited during startup');
    const listening = await listeners();
    if (ports.every(port => listening.has(port))) return;
    await delay(500);
  }
  throw new Error(`OpenMir2 listeners not ready: ${ports.join(', ')}`);
}

async function stop(code = 0) {
  if (stopping) return;
  stopping = true; ready = false;
  const game = children.get('GameSrv');
  if (game && game.exitCode === null) {
    saveAcknowledged = false;
    game.stdin.write('save\n');
    for (let attempt = 0; attempt < 65 && !saveAcknowledged && game.exitCode === null; attempt++) await delay(200);
    if (!saveAcknowledged) { console.error('OpenMir2 did not acknowledge player saves.'); code = 1; }
    game.kill('SIGINT');
    // Native shutdown drains its gateway in two five-second phases.
    for (let attempt = 0; attempt < 100 && game.exitCode === null; attempt++) await delay(200);
    if (game.exitCode !== 0) { console.error(`OpenMir2 GameSrv did not stop cleanly: ${game.exitCode ?? game.signalCode ?? 'timeout'}`); code = 1; }
    else console.log('OPENMIR2_GAME_EXIT=0');
  }
  for (const child of children.values()) if (child.exitCode === null) child.kill('SIGTERM');
  for (let attempt = 0; attempt < 30 && [...children.values()].some(child => child.exitCode === null); attempt++) await delay(200);
  for (const child of children.values()) if (child.exitCode === null) child.kill('SIGKILL');
  process.exit(code);
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());

try {
  await mkdir(root, { recursive: true });
  for (const [assembly, directory] of services) {
    await mkdir(join(root, directory), { recursive: true });
    await cp(`/engine/${assembly}`, join(root, directory), { recursive: true });
  }
  await cp('/engine/DBSvr.Storage.MySQL', join(root, 'DBServer'), { recursive: true });
  try { await readFile(join(root, '.seed-version')); }
  catch {
    for (const folder of ['Envir', 'Map', 'Castle', 'GuildBase', 'Notice']) await cp(`/seed/Mir200/${folder}`, join(root, 'Mir200', folder), { recursive: true });
    await normalize(join(root, 'Mir200'));
    await writeFile(join(root, '.seed-version'), 'f38deae64c521a28f8e0d86f2bf24d4ba7c9ea5c\n');
  }
  const profileVersion = 'classic-7e5782118c78defb42d8ffb55ca3a3de199e90a6-7';
  let installedProfile = '';
  try { installedProfile = await readFile(join(root, '.profile-version'), 'utf8'); } catch {}
  if (installedProfile !== profileVersion) {
    for (const folder of ['Map', 'Envir']) await cp(`/profile/${folder}`, join(root, 'Mir200', folder), { recursive: true });
    await writeFile(join(root, '.profile-version'), profileVersion);
  }
  const serverName = '热血传奇';
  const connection = database => `server=${process.env.MIR_DB_HOST ?? 'db'};uid=root;pwd=${process.env.MIR_DB_PASSWORD};database=${database};`;
  if (!process.env.MIR_DB_PASSWORD) throw new Error('MIR_DB_PASSWORD is required');
  await config('LoginSrv', 'logsrv.conf', { DataBase: { ConnctionString: connection('mir2_account') }, Server: { GateAddr: '127.0.0.1', GatePort: 5500, ServerAddr: '127.0.0.1', ServerPort: 5600, DBServer: '127.0.0.1', DBSPort: 5600, TestServer: 'TRUE', DynamicIPMode: 0 } });
  await config('DBServer', 'dbsvr.conf', { DataBase: { ConnctionString: connection('mir2_db') }, Setup: { ServerName: serverName, ServerAddr: '127.0.0.1', ServerPort: 6000, GateAddr: '127.0.0.1', GatePort: 5100, EnglishNameOnly: 0, DynamicIPMode: 0, MapFile: join(root, 'Mir200/Envir/MapInfo.txt') }, Server: { IDSAddr: '127.0.0.1', IDSPort: 5600 } });
  await config('Mir200', 'server.conf', { DataBase: { DbType: 'MySQL', ConnctionString: connection('mir2_data') }, Server: { ServerName: serverName, GateAddr: '127.0.0.1', GatePort: 5000, DBAddr: '127.0.0.1', DBPort: 6000, IDSAddr: '127.0.0.1', IDSPort: 5600, TestServer: 'TRUE', TestLevel: 1, TestGold: 0, ServerIndex: 0, EnableMarket: 0, EnableChatServer: 0, ShutdownSeconds: 0 }, Share: { BaseDir: join(root, 'Mir200'), EnvirDir: join(root, 'Mir200/Envir'), MapDir: join(root, 'Mir200/Map'), CastleDir: join(root, 'Mir200/Castle'), CastleFile: join(root, 'Mir200/Castle/List.txt'), GuildDir: join(root, 'Mir200/GuildBase/Guilds'), GuildFile: join(root, 'Mir200/GuildBase/GuildList.txt'), NoticeDir: join(root, 'Mir200/Notice') }, Setup: { HomeMap: '0', HomeX: 333, HomeY: 333, JobHomePointSystem: 0 } }, '/seed/Mir200/Server.conf');
  for (const name of ['Command', 'Global']) await bomWrite(join(root, 'Mir200', name.toLowerCase() + '.conf'), text(await readFile(`/seed/Mir200/${name}.conf`)));
  await cp('/profile/exps.conf', join(root, 'Mir200/exps.conf'));
  await bomWrite(join(root, 'Mir200/string.conf'), '');
  await bomWrite(join(root, 'Mir200/!runaddr.txt'), '127.0.0.1\n');
  await bomWrite(join(root, 'Mir200/!servertable.txt'), '0 127.0.0.1 7200\n');
  await bomWrite(join(root, 'Mir200/Envir/AdminList.txt'), '');
  await bomWrite(join(root, 'LoginSrv/AddrTable.txt'), `${serverName} Title1 127.0.0.1 127.0.0.1 127.0.0.1:7100\n`);
  await bomWrite(join(root, 'LoginSrv/ServerAddr.txt'), '127.0.0.1\n');
  await bomWrite(join(root, 'LoginSrv/UserLimit.txt'), `${serverName} ${serverName} 3000\n`);
  await bomWrite(join(root, 'DBServer/AddrTable.txt'), '127.0.0.1\n');
  await bomWrite(join(root, 'DBServer/ServerInfo.txt'), `${serverName} 127.0.0.1 7200\n`);
  await config('LoginGate', 'config.conf', { LoginGate: { Count: 1, ServerAddr0: '127.0.0.1', ServerPort0: 5500, GateAddr0: '0.0.0.0', GatePort0: 7000 }, Method: { BlockIPMethod: 'mDisconnect' }, Integer: { MaxConnectOfIP: 100 }, Switch: { CheckNewIDOfIP: 0 } });
  await config('SelGate', 'config.conf', { SelGate: { Count: 1, ServerAddr0: '127.0.0.1', ServerPort0: 5100, GatePort0: 7100 }, Integer: { MaxConnectOfIP: 100 } });
  await config('RunGate', 'config.conf', { GameGate: { ServerWorkThread: 1, ServerAddr1: '127.0.0.1', ServerPort1: 5000, GateAddress1: '0.0.0.0', GatePort1: 7200 }, Integer: { MaxConnectOfIP: 100 } });
  for (const [assembly, directory] of services) {
    const required = { DBSrv: [5600], GameSrv: [5600, 6000], LoginGate: [5500], SelGate: [5100], GameGate: [5000] }[assembly];
    if (required) await waitPorts(required);
    const child = spawn('dotnet', [join(root, directory, assembly + '.dll')], { cwd: join(root, directory), stdio: ['pipe', 'pipe', 'pipe'] });
    children.set(assembly, child);
    let logTail = '';
    child.stdout.on('data', bytes => {
      process.stdout.write(`[${assembly}] ${bytes}`);
      if (assembly === 'GameSrv') {
        logTail = (logTail + bytes.toString()).slice(-1024);
        if (logTail.includes('OPENMIR2_SAVE_COMPLETE')) { saveAcknowledged = true; logTail = ''; }
      }
    });
    child.stderr.on('data', bytes => process.stderr.write(`[${assembly}] ${bytes}`));
    child.once('error', error => { console.error(`${assembly}: ${error.message}`); void stop(1); });
    child.once('exit', (code, signal) => { if (!stopping) { console.error(`${assembly} exited: ${code ?? signal}`); void stop(1); } });
  }
  await waitPorts([7000, 7100, 7200]);
  ready = true;
  createServer((req, res) => { res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ engine: 'OpenMir2', ready })); }).listen(8081, '0.0.0.0');
  console.log('OpenMir2 engine is ready.');
} catch (error) { console.error(error.message); await stop(1); }
