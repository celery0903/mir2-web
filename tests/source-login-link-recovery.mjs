import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const execute = promisify(execFile);
const project = 'mir2-group-native';
const engine = `${project}-engine-1`;
const destination = resolve(process.env.MIR_LOGIN_LINK_REPORT ?? '.runtime/reports/login-link-recovery');
const expectedImage = process.env.MIR_LOGIN_LINK_ENGINE_IMAGE;
assert.match(expectedImage ?? '', /^sha256:[a-f0-9]{64}$/, 'Declare the tested engine image');
const inspect = async name => JSON.parse((await execute('docker', ['inspect', name])).stdout)[0];
const container = await inspect(engine), database = await inspect(`${project}-db-1`);
assert.equal(container.Image, expectedImage);
assert.ok(container.HostConfig.Tmpfs['/data'], 'Recovery check requires an isolated ephemeral engine');
assert.ok(database.HostConfig.Tmpfs['/var/lib/mysql'], 'Recovery check requires an isolated ephemeral database');
assert.ok(!container.Mounts.some(mount => mount.Type === 'volume'));
const pid = (await execute('docker', ['exec', engine, 'node', '--input-type=module', '-e',
  "import {readdir,readFile} from 'node:fs/promises'; for(const pid of await readdir('/proc')) { if(!/^\\d+$/.test(pid))continue; try { const cmd=await readFile('/proc/'+pid+'/cmdline','utf8'); if(cmd.split('\\0')[1]==='/data/server/Mir200/GameSrv.dll')console.log(pid); }catch{} }"])).stdout.trim();
assert.match(pid, /^\d+$/);
await mkdir(destination, { recursive: true });
const report = { checkedAt: new Date().toISOString(), passed: false, full176Acceptance: false,
  scope: 'Pause GameSrv only in the isolated ephemeral stack until the actual LoginSrv heartbeat expires; verify HTTP 503, automatic authentication recovery and HTTP 200 without restarting the container.', image: expectedImage };
let paused = false;
const signal = name => execute('docker', ['exec', engine, 'node', '-e',
  'process.kill(Number(process.argv[1]), process.argv[2])', pid, name]);
async function health() {
  const result = await execute('docker', ['exec', engine, 'node', '--input-type=module', '-e',
    "const r=await fetch('http://127.0.0.1:8081/health',{signal:AbortSignal.timeout(2000)});console.log(JSON.stringify({status:r.status,body:await r.json()}));"]);
  return JSON.parse(result.stdout);
}
async function until(check, timeout) {
  const deadline = Date.now() + timeout;
  while (!await check()) {
    assert.ok(Date.now() < deadline, 'Native login link did not reach its expected state');
    await delay(1000);
  }
}
try {
  report.before = await health();
  assert.equal(report.before.status, 200);
  paused = true;
  await signal('SIGSTOP');
  await until(async () => {
    const state = await health();
    if (state.status === 503) { report.disconnected = state; return true; }
    return false;
  }, 45000);
  assert.equal(report.disconnected.body.ready, false);
  const logs = (await execute('docker', ['logs', '--since', report.checkedAt, engine])).stdout;
  assert.ok(logs.includes('游戏服务器响应超时,关闭链接'), 'Actual LoginSrv did not expire the authentication peer');
  await signal('SIGCONT');
  paused = false;
  await until(async () => {
    const state = await health();
    if (state.status === 200) { report.recovered = state; return true; }
    return false;
  }, 15000);
  assert.equal(report.recovered.body.ready, true);
  const after = await inspect(engine);
  assert.equal(after.Id, container.Id);
  assert.equal(after.State.StartedAt, container.State.StartedAt);
  assert.equal(after.RestartCount, container.RestartCount);
  report.containerPreserved = true;
  report.passed = true;
  console.log('Actual native heartbeat loss returned 503 and recovered to 200 without restarting the isolated engine.');
} catch (error) { report.error = String(error); throw error; }
finally {
  if (paused) {
    try { await signal('SIGCONT'); }
    catch (error) { report.passed = false; report.resumeError = String(error); process.exitCode = 1; }
  }
  await writeFile(join(destination, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
}
