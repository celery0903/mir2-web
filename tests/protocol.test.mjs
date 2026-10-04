import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { createConnection } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { baseURL, register, Session, delay, directionTo, waitHealthy } from './session.mjs';

await waitHealthy();

test('gateway rejects foreign origins and invalid credentials', async () => {
  const foreign = await fetch(`${baseURL}/api/register`, { method: 'POST', headers: { Origin: 'https://other.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ accountID: 'untrusted', password: 'invalid' }) });
  assert.equal(foreign.status, 403);
  const invalid = await fetch(`${baseURL}/api/register`, { method: 'POST', headers: { Origin: new URL(baseURL).origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ accountID: '!', password: 'x' }) });
  assert.equal(invalid.status, 400);
  const longProfile = await fetch(`${baseURL}/api/register`, { method: 'POST', headers: { Origin: new URL(baseURL).origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ accountID: 'profileqa', password: 'Valid987', userName: '汉'.repeat(11) }) });
  assert.equal(longProfile.status, 400, 'Profile fields must fit the legacy byte width without silent truncation');
  const longMobile = await fetch(`${baseURL}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountID: 'mobileqa', password: 'Valid987', mobile: '130000000000' }) });
  assert.equal(longMobile.status, 400, 'Mobile numbers must fit the native database column');
  const socket = new WebSocket(baseURL.replace('http', 'ws') + '/ws', { origin: 'https://other.example' });
  const status = await new Promise(resolve => { socket.once('unexpected-response', (_, response) => { response.resume(); resolve(response.statusCode); socket.terminate(); }); socket.on('error', () => {}); });
  assert.equal(status, 403);
});

test('eight simultaneous connections complete the OpenMir2 handshake', async () => {
  const sessions = Array.from({ length: 8 }, () => new Session());
  try { await Promise.all(sessions.map(session => session.wait('Ready'))); }
  finally { await Promise.all(sessions.map(session => session.close())); }
});

test('registration profile reaches the native account database without field substitutions', { skip: !process.env.MIR_COMPOSE_PROJECT }, async () => {
  const project = process.env.MIR_COMPOSE_PROJECT;
  assert.match(project, /^mir2-rebuild$/);
  const accountID = `p${String(Date.now()).slice(-8)}`;
  const profile = { userName: '注册测试', identity: '', birthDay: '2000/01/01', question: '测试问题', answer: '测试答案', question2: '测试问题二', answer2: '测试答案二', phone: '01000000000', mobile: '13000000000', email: 'qa@example.test' };
  const response = await fetch(`${baseURL}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountID, password: 'Profile987', ...profile }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result, 8);
  const sql = `SELECT JSON_OBJECT('userName',p.UserName,'identity',p.IdCard,'birthDay',p.Birthday,'question',p.Quiz1,'answer',p.Answer1,'question2',p.Quiz2,'answer2',p.Answer2,'phone',p.Phone,'mobile',p.MobilePhone,'email',p.EMail) FROM account_protection p JOIN account a ON p.AccountId=a.Id WHERE a.Account='${accountID}'`;
  const { stdout } = await promisify(execFile)('docker', ['exec', `${project}-db-1`, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --default-character-set=utf8mb4 -uroot --batch --raw --skip-column-names mir2_account -e "$1"', 'sh', sql]);
  assert.deepEqual(JSON.parse(stdout), profile);
});

test('fragmented malformed native frames leave the login worker available', { skip: !process.env.MIR_NATIVE_LOGIN_PORT }, async () => {
  const port = Number(process.env.MIR_NATIVE_LOGIN_PORT);
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
  const socket = createConnection({ host: '127.0.0.1', port });
  try {
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
    socket.write('#1<<<');
    await delay(100);
    socket.write('!#1<<<<!');
    await delay(200);
    const s = new Session();
    try { await s.wait('Ready'); }
    finally { await s.close(); }
    // The following three-job test must still complete authenticated logins.
  } finally { socket.destroy(); }
});

test('native three-job creation, multiplayer, equipment, combat, harvest and relogin', { timeout: 240000 }, async () => {
  const suffix = String(Date.now()).slice(-7), password = 'Test98765';
  const fixtures = [0, 1, 2].map(job => ({ accountID: `qa${job}${suffix}`, password, name: ['战', '法', '道'][job] + suffix, job }));
  const sessions = [];
  try {
    for (const f of fixtures) {
      await register(f.accountID, password);
      const s = new Session(); sessions.push(s);
      await s.login(f.accountID, password); await s.create(f.name, f.job, f.job % 2);
      assert.equal(s.user.class, f.job);
      assert.equal(s.user.level, 1); assert.equal(s.user.gold, 0);
      assert.equal(s.user.maxExperience, 100, 'Classic level-one experience must not be accelerated');
      assert.equal(s.user.inventory.filter(Boolean).length, 4);
      assert.ok(s.user.inventory.slice(0, 6).filter(Boolean).every(item => item.stdMode <= 3), 'The six shortcut cells must contain consumables');
      assert.deepEqual(s.user.inventory.slice(6).filter(Boolean).map(item => item.name).sort(), ['布衣(男)', '木剑', '蜡烛'].map(name => name === '布衣(男)' && f.job % 2 ? '布衣(女)' : name).sort());
      await s.equipStarter(); await s.equipClothes();
    }
    const [one, two] = sessions;
    await one.wait('ObjectPlayer', d => d.objectID === two.user.objectID);
    await two.wait('ObjectPlayer', d => d.objectID === one.user.objectID);
    const p = { ...one.user.location };
    const path = await one.pathTo(p.x + 2, p.y + 2);
    assert.ok(path.length > 1);
    await one.walk(directionTo(path[1][0] - p.x, path[1][1] - p.y));
    assert.notDeepEqual(one.user.location, p);
    await two.wait('ObjectWalk', d => d.objectID === one.user.objectID && d.location.x === one.user.location.x && d.location.y === one.user.location.y);
    const chatAt = two.events.length;
    one.send('Chat', { message: '比奇同行' });
    await two.wait('Chat', d => d.message.includes('比奇同行'), 10000, chatAt);
    const potion = one.user.inventory.find(i => i && one.items.get(i.itemIndex)?.name.startsWith('金创药'));
    const useAt = one.events.length;
    one.send('UseItem', { uniqueID: potion.uniqueID });
    await one.wait('UserSlotsRefresh', d => !d.inventory.some(i => i?.uniqueID === potion.uniqueID), 10000, useAt);
    const deer = await one.seekMonster(['鹿']);
    const combatAt = one.events.length;
    const corpse = await one.fight(deer.objectID);
    await one.wait('UserExperience', d => d.amount > 0, 10000, combatAt);
    await one.wait('DamageIndicator', d => d.objectID === deer.objectID && d.damage > 0, 10000, combatAt);
    const harvestAt = one.events.length;
    for (let i = 0; i < 30 && !one.user.inventory.some(item => item?.stdMode === 40); i++) {
      one.send('Harvest', { objectID: corpse.objectID, ...corpse.location, direction: directionTo(corpse.location.x - one.user.location.x, corpse.location.y - one.user.location.y) });
      await delay(650);
    }
    try { await one.wait('UserSlotsRefresh', d => d.inventory.some(i => i?.stdMode === 40), 10000, harvestAt); }
    catch (error) { throw new Error(`Harvest at ${JSON.stringify(corpse.location)}, player ${JSON.stringify(one.user.location)}: ${JSON.stringify(one.events.slice(harvestAt).filter(e => ['ObjectHarvest','Chat','UserSlotsRefresh'].includes(e.type)).slice(-8))}`, { cause: error }); }
    assert.ok(one.user.mp >= 0, 'Physical damage must preserve mana');
    for (let i = 0; i < fixtures.length; i++) {
      const s = sessions[i];
      Object.assign(fixtures[i], { location: { ...s.user.location }, gold: s.user.gold, level: s.user.level, experience: s.user.experience, equipment: s.user.equipment.map(i => i?.uniqueID ?? null), inventory: s.user.inventory.filter(Boolean).map(i => i.uniqueID) });
      await s.logout();
      const again = new Session(); sessions.push(again);
      const login = await again.login(fixtures[i].accountID, password);
      await again.enter(login.characters.find(c => c.name === fixtures[i].name).index);
      assert.equal(again.user.experience, fixtures[i].experience);
      assert.deepEqual(again.user.location, fixtures[i].location);
      assert.deepEqual(again.user.equipment.map(i => i?.uniqueID ?? null), fixtures[i].equipment);
      assert.deepEqual(again.user.inventory.filter(Boolean).map(i => i.uniqueID).sort(), fixtures[i].inventory.slice().sort());
      await again.logout();
    }
    await mkdir('.state', { recursive: true });
    await writeFile(process.env.MIR_FIXTURES_FILE ?? '.state/native-fixtures.json', JSON.stringify(fixtures, null, 2) + '\n');
    console.log('PASS: three native jobs, observed multiplayer movement/chat, combat XP/damage, deer harvest, equipment and relogin persistence.');
  } finally { await Promise.all(sessions.map(s => s.close())); }
});
