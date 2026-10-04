import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { baseURL, register, Session, delay, directionTo } from './session.mjs';

test('gateway rejects foreign origins and invalid registration input', async () => {
  const foreign = await fetch(`${baseURL}/api/register`, { method: 'POST', headers: { Origin: 'https://other.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ accountID: 'untrusted', password: 'invalid' }) });
  assert.equal(foreign.status, 403);
  const invalid = await fetch(`${baseURL}/api/register`, { method: 'POST', headers: { Origin: new URL(baseURL).origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ accountID: '!', password: 'x' }) });
  assert.equal(invalid.status, 400);
  const socket = new WebSocket(baseURL.replace('http', 'ws') + '/ws', { origin: 'https://other.example' });
  const status = await new Promise(resolve => { socket.once('unexpected-response', (_, response) => { response.resume(); resolve(response.statusCode); socket.terminate(); }); socket.on('error', () => {}); });
  assert.equal(status, 403);
});

test('simultaneous browser connections all complete the Crystal handshake', async () => {
  const sessions = Array.from({ length: 8 }, () => new Session());
  try { await Promise.all(sessions.map(session => session.wait('Ready'))); }
  finally { await Promise.all(sessions.map(session => session.close())); }
});

test('real Crystal accounts, two-player movement, combat, loot, equipment and saved progress', { timeout: 120000 }, async () => {
  const suffix = Date.now().toString().slice(-10);
  const accountID = `a${suffix}`, secondID = `b${suffix}`, password = 'Test98765';
  await register(accountID, password);
  await register(secondID, password);
  const one = new Session(), two = new Session();
  try {
    await one.login(accountID, password);
    await one.create(`武者${suffix.slice(-5)}`, 0);
    await one.equipStarter();
    await two.login(secondID, password);
    await two.create(`术士${suffix.slice(-5)}`, 1);
    await one.wait('ObjectPlayer', d => d.objectID === two.user.objectID);
    await two.wait('ObjectPlayer', d => d.objectID === one.user.objectID);
    const initial = { ...one.user.location };
    await one.walk(2);
    assert.equal(one.user.location.x, initial.x + 1);
    await two.wait('ObjectWalk', d => d.objectID === one.user.objectID && d.location.x === one.user.location.x);
    const beforeChat = two.events.length;
    one.send('Chat', { message: '青石镇见' });
    await two.wait('ObjectChat', d => d.text.includes('青石镇见') && d.objectID === one.user.objectID, 10000, beforeChat);
    const gmStart = one.events.length;
    one.send('Chat', { message: '@LOGIN' });
    await one.wait('Chat', d => /gm password/i.test(d.message), 10000, gmStart);
    one.send('Chat', { message: 'C#Mir 4.0' });
    await one.wait('Chat', d => d.message === 'Incorrect login password', 10000, gmStart);
    const potion = one.user.inventory.find(i => i && one.items.get(i.itemIndex)?.type === 13);
    assert.ok(potion, 'Crystal must supply a starter potion');
    one.send('UseItem', { uniqueID: potion.uniqueID, grid: 1 });
    await one.wait('UseItem', d => d.uniqueID === potion.uniqueID && d.success);
    const mobs = [...one.objects.values()].filter(o => o.type === 'ObjectMonster' && !o.dead);
    assert.ok(mobs.length > 0, 'Crystal must spawn actual monsters');
    let target = mobs.sort((a, b) => Math.max(Math.abs(a.location.x - one.user.location.x), Math.abs(a.location.y - one.user.location.y)) - Math.max(Math.abs(b.location.x - one.user.location.x), Math.abs(b.location.y - one.user.location.y)))[0];
    const combatStart = one.events.length;
    for (let i = 0; i < 65 && !target.dead; i++) {
      assert.ok(!one.dead, 'Player must survive the starter encounter');
      const p = one.user.location, m = target.location;
      const distance = Math.max(Math.abs(p.x - m.x), Math.abs(p.y - m.y));
      if (distance <= 1) { one.send('Attack', { direction: directionTo(m.x - p.x, m.y - p.y), spell: 0 }); await delay(1450); }
      else {
        const path = one.pathTo(m.x, m.y);
        assert.ok(path.length > 1, 'A real monster must be reachable');
        await one.walk(directionTo(path[1][0] - p.x, path[1][1] - p.y));
      }
      target = one.objects.get(target.objectID) ?? { ...target, dead: true };
    }
    await one.wait('GainExperience', () => true, 10000, combatStart);
    await one.wait('ObjectGold', () => true, 10000, combatStart);
    const goldDrop = [...one.objects.values()].find(o => o.type === 'ObjectGold');
    assert.ok(goldDrop, 'A killed Crystal monster must drop gold');
    await one.moveTo(goldDrop.location.x, goldDrop.location.y);
    const lootStart = one.events.length;
    for (let i = 0; i < 5; i++) { one.send('PickUp'); await delay(650); }
    await one.wait('GainedGold', () => true, 10000, lootStart);
    const itemDrop = [...one.objects.values()].find(o => o.type === 'ObjectItem');
    assert.ok(itemDrop, 'A killed Crystal monster must drop an actual item');
    await one.moveTo(itemDrop.location.x, itemDrop.location.y);
    const itemStart = one.events.length;
    one.send('PickUp');
    await one.wait('GainedItem', () => true, 10000, itemStart);
    assert.ok(one.user.gold >= 1);
    const fixture = { accountID, password, characterIndex: one.user.realId, name: one.user.name, location: one.user.location, gold: one.user.gold, experience: one.user.experience, level: one.user.level, weaponIndex: 1 };
    await mkdir(new URL('../.state/', import.meta.url), { recursive: true });
    await writeFile(new URL('../.state/persistence.json', import.meta.url), JSON.stringify(fixture));
    console.log(`Verified Crystal multiplayer and combat; saved ${fixture.gold} gold for restart verification.`);
  } finally { await one.close(); await two.close(); }
});

test('gateway closes unsupported commands without crashing the server', async () => {
  const session = new Session();
  await session.wait('Ready');
  const closed = new Promise(resolve => session.socket.once('close', resolve));
  session.send('GiveMeGold', { amount: 999999 });
  await closed;
  const response = await fetch(`${baseURL}/healthz`);
  assert.equal(response.status, 200);
});
