import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Session, waitHealthy } from './session.mjs';

await waitHealthy();
const fixtures = JSON.parse(await readFile('.state/native-fixtures.json'));
const evidence = [];
for (const f of fixtures) {
  const s = new Session();
  try {
    const { characters } = await s.login(f.accountID, f.password);
    const character = characters.find(c => c.name === f.name);
    assert.ok(character, 'Character must survive container restart');
    await s.enter(character.index);
    assert.equal(s.user.gold, f.gold, 'Gold must persist');
    assert.equal(s.user.level, f.level, 'Level must persist');
    assert.equal(s.user.experience, f.experience, 'Experience must persist');
    assert.deepEqual(s.user.location, f.location, 'Coordinates must persist');
    assert.equal(s.map, f.map ?? '0', 'Map must persist');
    assert.deepEqual(s.user.equipment.map(i => i?.uniqueID ?? null), f.equipment, 'Equipment IDs must persist');
    assert.deepEqual(s.user.inventory.filter(Boolean).map(i => i.uniqueID).sort(), f.inventory.slice().sort(), 'Inventory IDs must persist');
    if (f.magic) assert.ok(s.user.magics.some(m => m.spell === f.magic.spell && m.key === f.magic.key), 'Skill and key must persist');
    await s.logout();
    evidence.push({ job: f.job, characterPreserved: true, location: f.location, map: f.map ?? '0', gold: f.gold, level: f.level, experience: f.experience, equipmentIDsPreserved: true, inventoryIDsPreserved: true, inventoryCount: f.inventory.length, magic: f.magic, skillAndKeyPreserved: Boolean(f.magic) });
    console.log(`PASS: job ${f.job} account, character, position, gold, XP, equipment, inventory${f.magic ? ', skill and key' : ''} survived restart.`);
  } finally { await s.close(); }
}
await writeFile('.state/persistence-evidence.json', JSON.stringify(evidence, null, 2) + '\n');
