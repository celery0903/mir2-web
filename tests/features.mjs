import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Session, delay, waitHealthy } from './session.mjs';

if (process.env.MIR_TEST_FIXTURES !== '1') throw new Error('This test modifies only qa test accounts. Set MIR_TEST_FIXTURES=1 explicitly.');
const fixtures = JSON.parse(await readFile('.state/native-fixtures.json'));
const project = process.env.MIR_COMPOSE_PROJECT ?? 'mir2-rebuild';
if (!/^[a-z0-9-]+$/.test(project)) throw new Error('Invalid Compose project');
const run = promisify(execFile);
if (!fixtures.every(f => /^qa[012]\d{7}$/.test(f.accountID))) throw new Error('Fixture account is outside the qa namespace');
await run('docker', ['stop', `${project}-engine-1`], { timeout: 65000 });
for (const f of fixtures) {
  if (!/^qa[012]\d{7}$/.test(f.accountID)) throw new Error('Fixture account is outside the qa namespace');
  await run('docker', ['exec', `${project}-db-1`, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --default-character-set=utf8mb4 -uroot mir2_db -e "$1"', 'sh', `DELETE m FROM characters_magic m JOIN characters c ON m.PlayerId=c.Id WHERE c.LoginID='${f.accountID}'; UPDATE characters c JOIN characters_ablity a ON a.PlayerId=c.Id SET c.Level=7,c.Gold=20000,a.Level=7,a.Hp=30,a.Mp=30,a.Exp=0 WHERE c.LoginID='${f.accountID}';`]);
}
await run('docker', ['start', `${project}-engine-1`]);
await waitHealthy();
const evidence = [];
for (const f of fixtures) {
  const s = new Session();
  try {
    await s.login(f.accountID, f.password); await s.enter(0);
    assert.equal(s.user.level, 7);
    assert.equal(s.user.gold, 20000);
    await s.moveNear(288, 609);
    const npc = await s.wait('ObjectNPC',o=>o.name==='边界杂货店');
    let after = s.events.length;
    s.send('CallNPC', { objectID: npc.objectID });
    await s.wait('NPCResponse', d => d.page.some(line => line.includes('@buy')), 10000, after);
    s.send('CallNPC', { objectID: npc.objectID, key: '[@buy]' });
    const goods = await s.wait('NPCGoods', d => d.list.some(i => i.name.startsWith('魔法药')), 10000, after);
    const potion = goods.list.find(i => i.name === '魔法药(小量)');
    assert.ok(potion);
    const beforeGold = s.user.gold;
    const oldPotions = new Set(s.user.inventory.filter(Boolean).map(i => i.uniqueID));
    after = s.events.length;
    s.send('BuyItem', { itemIndex: potion.itemIndex, count: 1 });
    await s.wait('UserSlotsRefresh', d => d.inventory.some(i => i?.name === potion.name), 10000, after);
    await s.wait('UserGold', d => d.gold < beforeGold, 10000, after);
    const bought = s.user.inventory.find(i => i?.name === potion.name && !oldPotions.has(i.uniqueID));
    assert.ok(bought);
    after = s.events.length;
    s.send('CallNPC', { objectID: npc.objectID, key: '[@Main]' });
    await s.wait('NPCResponse', d => d.page.some(line => line.includes('@sell')), 10000, after);
    after = s.events.length;
    s.send('CallNPC', { objectID: npc.objectID, key: '[@sell]' });
    await s.wait('NPCSell', () => true, 10000, after);
    const saleGold = s.user.gold;
    s.send('SellItem', { uniqueID: bought.uniqueID });
    await s.wait('UserSlotsRefresh', d => !d.inventory.some(i => i?.uniqueID === bought.uniqueID), 10000, after);
    await s.wait('UserGold', d => d.gold > saleGold, 10000, after);
    console.log(`PASS: job ${f.job}, original merchant potion bought and sold with matching gold and inventory changes.`);
    if (f.job === 0) {
      after = s.events.length;
      s.send('CallNPC', { objectID: npc.objectID, key: '[@Main]' });
      await s.wait('NPCResponse', d => d.page.some(line => line.includes('@buy')), 10000, after);
      after = s.events.length;
      s.send('CallNPC', { objectID: npc.objectID, key: '[@buy]' });
      const supplies = await s.wait('NPCGoods', () => true, 10000, after);
      const healing = supplies.list.find(i => i.name === '金创药(小量)');
      assert.ok(healing);
      const supplyCount = s.user.inventory.filter(i => i?.name === healing.name).length;
      for (let n = supplyCount; n < 10; n++) {
        const oldGold = s.user.gold;
        after = s.events.length;
        s.send('BuyItem', { itemIndex: healing.itemIndex, count: 1 });
        await s.wait('UserGold', d => d.gold < oldGold, 10000, after);
      }
    }
    await s.moveTo(283, 636);
    after = s.events.length;
    await s.walk(6);
    await s.wait('MapInformation', d => d.map === '0132', 10000, after);
    assert.equal(s.map, '0132');
    await s.moveTo(12, 13);
    const bookseller = await s.wait('ObjectNPC',o=>o.name==='书店');
    after = s.events.length;
    s.send('CallNPC', { objectID: bookseller.objectID });
    await s.wait('NPCResponse', () => true, 10000, after);
    s.send('CallNPC', { objectID: bookseller.objectID, key: '[@buy]' });
    const books = await s.wait('NPCGoods', () => true, 10000, after);
    const skillName = ['基本剑术', '火球术', '治愈术'][f.job];
    const book = books.list.find(i => i.name === skillName);
    assert.ok(book, `Bookshop must offer ${skillName}`);
    const oldItems = new Set(s.user.inventory.filter(Boolean).map(i => i.uniqueID));
    after = s.events.length;
    s.send('BuyItem', { itemIndex: book.itemIndex, count: 1 });
    await s.wait('UserSlotsRefresh', d => d.inventory.some(i => i?.name === skillName && !oldItems.has(i.uniqueID)), 10000, after);
    const item = s.user.inventory.find(i => i?.name === skillName && !oldItems.has(i.uniqueID));
    after = s.events.length;
    s.send('UseItem', { uniqueID: item.uniqueID });
    await s.wait('UserMagics', d => d.magics.some(m => m.name === skillName), 10000, after);
    const magic = s.user.magics.find(m => m.name === skillName);
    assert.equal(magic.spell, [3, 1, 2][f.job]);
    console.log(`PASS: job ${f.job}, entered native bookshop and learned ${skillName} from the newly purchased book.`);
    s.send('MagicKey', { spell: magic.spell, key: 1 });
    await delay(500);
    await s.moveTo(14, 15);
    after = s.events.length;
    await s.walk(4);
    await s.wait('MapInformation', d => d.map === '0', 10000, after);
    let cast;
    if (f.job !== 0) {
      await delay(1000);
      const target = f.job === 1 ? await s.seekMonster(['鹿','稻草人']) : { objectID: s.user.objectID, location: s.user.location };
      assert.ok(target);
      const mana = s.user.mp, health = s.user.hp;
      after = s.events.length;
      s.send('Magic', { spell: magic.spell, targetID: target.objectID, location: target.location });
      cast = await s.wait('MagicEffect', d => d.objectID === s.user.objectID, 10000, after);
      await s.wait('HealthChanged', d => d.mp < mana, 10000, after);
      assert.equal(cast.effect, f.job === 1 ? 1 : 2);
      if (f.job === 1) await s.wait('DamageIndicator', d => d.objectID === target.objectID && d.damage > 0, 10000, after);
      else if (health < s.user.maxHP) await s.wait('HealthChanged', d => d.hp > health, 15000, after);
    }
    let loot;
    if (f.job === 0) {
      for (let attempt = 0, kills = 0; attempt < 30 && kills < 12 && !loot; attempt++) {
        const target = await s.seekMonster(['稻草人','多钩猫','钉耙猫']);
        after = s.events.length;
        let corpse;
        try { corpse = await s.fight(target.objectID); }
        catch (error) {
          if (error.message !== 'Combat target left the visible area') throw error;
          continue;
        }
        kills++;
        await delay(800);
        const drops = s.events.slice(after).filter(e => ['ObjectGold','ObjectItem'].includes(e.type) && Math.max(Math.abs(e.data.location.x-corpse.location.x),Math.abs(e.data.location.y-corpse.location.y))<=5);
        if (!drops.length) continue;
        const drop = drops[0].data, count = s.user.inventory.filter(Boolean).length, oldGold = s.user.gold;
        try { await s.moveTo(drop.location.x,drop.location.y); }
        catch (error) {
          if (!error.message.startsWith('Server blocked path')) throw error;
          console.log(`A live actor blocked drop ${drop.name}; continuing patrol.`);
          continue;
        }
        after = s.events.length; s.send('Pickup');
        await s.wait('ObjectRemove',d=>d.objectID===drop.objectID,10000,after);
        if (drops[0].type==='ObjectGold') await s.wait('UserGold',d=>d.gold>oldGold,10000,after);
        else await s.wait('UserSlotsRefresh',d=>d.inventory.filter(Boolean).length>count,10000,after);
        loot = { monster:target.name,drop:drop.name,pickedUp:true };
      }
      assert.ok(loot,'Actual native random monster loot must be picked up');
      console.log(`PASS: actual ${loot.monster} drop ${loot.drop} picked up.`);
    }
    evidence.push({ job: f.job, skill: skillName, learnedFromPurchasedBook: true, spell: magic.spell, effect: cast?.effect, mapTransitions: ['0', '0132', '0'], shopBoughtAndSold: true, loot });
    Object.assign(f, { location: { ...s.user.location }, map: s.map, gold: s.user.gold, level: s.user.level, experience: s.user.experience, equipment: s.user.equipment.map(i => i?.uniqueID ?? null), inventory: s.user.inventory.filter(Boolean).map(i => i.uniqueID), magic: { spell: magic.spell, key: 1 } });
    await s.logout();
    await writeFile('.state/native-fixtures.json', JSON.stringify(fixtures, null, 2) + '\n');
    console.log(`PASS: job ${f.job}, original merchant buy/sell, bookshop transition and ${skillName}${cast ? ' cast' : ' passive learned'}.`);
  } finally { await s.close(); }
}
await writeFile('.state/native-fixtures.json', JSON.stringify(fixtures, null, 2) + '\n');
await writeFile('.state/feature-evidence.json', JSON.stringify({ fixture: 'Existing qa accounts raised offline to level 7 with 20000 gold; no spells or books injected.', evidence }, null, 2) + '\n');
