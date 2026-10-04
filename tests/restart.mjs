import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Session, delay, waitHealthy } from './session.mjs';

if (process.env.MIR_TEST_FIXTURES !== '1') throw new Error('Set MIR_TEST_FIXTURES=1 to restart the isolated acceptance stack.');
const project = process.env.MIR_COMPOSE_PROJECT ?? 'mir2-rebuild';
if (!/^[a-z0-9-]+$/.test(project)) throw new Error('Invalid Compose project');
const fixtures = JSON.parse(await readFile('.state/native-fixtures.json'));
assert.ok(fixtures.every(f => /^qa[012]\d{7}$/.test(f.accountID)));
const capture = (fixture, session) => Object.assign(fixture,{location:{...session.user.location},map:session.map,gold:session.user.gold,level:session.user.level,experience:session.user.experience,equipment:session.user.equipment.map(i=>i?.uniqueID??null),inventory:session.user.inventory.filter(Boolean).map(i=>i.uniqueID)});
await waitHealthy();
for (const fixture of fixtures) {
  const baseline = new Session();
  try {
    await baseline.login(fixture.accountID,fixture.password); await baseline.enter(0);
    assert.equal(baseline.user.gold,fixture.gold,'Gameplay gold must be intact before restarting');
    assert.equal(baseline.user.level,fixture.level);
    assert.ok(baseline.user.experience>=fixture.experience,'Settled gameplay experience must not decrease');
    assert.deepEqual(baseline.user.equipment.map(i=>i?.uniqueID??null),fixture.equipment);
    assert.deepEqual(baseline.user.inventory.filter(Boolean).map(i=>i.uniqueID).sort(),fixture.inventory.slice().sort());
    assert.ok(baseline.user.magics.some(m=>m.spell===fixture.magic.spell && m.key===fixture.magic.key));
    capture(fixture,baseline);
    await baseline.logout();
  } finally { await baseline.close(); }
}
const run = promisify(execFile), s = new Session(), f = fixtures[0];
try {
  await waitHealthy(); await s.login(f.accountID,f.password); await s.enter(0);
  const before = {...s.user.location};
  for (const direction of [2,4,6,0]) {
    await s.walk(direction);
    if (s.user.location.x !== before.x || s.user.location.y !== before.y) break;
  }
  assert.notDeepEqual(s.user.location,before,'An online unsaved movement must precede restart');
  capture(f,s);
  await writeFile('.state/native-fixtures.json',JSON.stringify(fixtures,null,2)+'\n');
  const since = new Date().toISOString();
  await run('docker',['stop',`${project}-web-1`,`${project}-engine-1`],{timeout:65000});
  const {stdout,stderr}=await run('docker',['logs','--since',since,`${project}-engine-1`]);
  const log=stdout+stderr;
  assert.ok(log.includes('OPENMIR2_SAVE_COMPLETE'),'The native engine must acknowledge committed player saves');
  assert.ok(log.includes('OPENMIR2_GAME_EXIT=0'),'The native game process must exit successfully');
  assert.ok(!log.includes('Unhandled exception'),'Shutdown must not throw an unhandled exception');
  assert.ok(!/acknowledgement timed out|did not acknowledge player saves/.test(log));
  const {stdout:exitCode}=await run('docker',['inspect','--format','{{.State.ExitCode}}',`${project}-engine-1`]);
  assert.equal(exitCode.trim(),'0','Engine must stop cleanly');
  await run('docker',['stop',`${project}-db-1`],{timeout:30000});
  await writeFile('.state/restart-evidence.json',JSON.stringify({preRestartBaselineCapturedForAllJobs:true,onlineCharacterSaved:true,location:f.location,saveAcknowledged:true,engineExitCode:0},null,2)+'\n');
  await run('docker',['start',`${project}-db-1`]);
  let databaseReady = false;
  for (let attempt=0;attempt<120;attempt++) {
    const {stdout:health}=await run('docker',['inspect','--format','{{.State.Health.Status}}',`${project}-db-1`]);
    if (health.trim()==='healthy') { databaseReady=true; break; }
    await delay(500);
  }
  assert.ok(databaseReady,'Database must become healthy after restart');
  await run('docker',['start',`${project}-engine-1`,`${project}-web-1`]);
  await waitHealthy(); await delay(1000);
  console.log('PASS: online movement saved with database acknowledgement; engine exited cleanly and restarted.');
} finally { await s.close(); }
await import('./persistence.mjs');
const shutdown = JSON.parse(await readFile('.state/restart-evidence.json'));
const characters = JSON.parse(await readFile('.state/persistence-evidence.json'));
await writeFile('.state/restart-evidence.json',JSON.stringify({ ...shutdown, databaseRestarted: true, characters },null,2)+'\n');
