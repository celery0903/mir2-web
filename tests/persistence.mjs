import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Session } from './session.mjs';

const fixture = JSON.parse(await readFile(new URL('../.state/persistence.json', import.meta.url)));
const session = new Session();
try {
  const { characters } = await session.login(fixture.accountID, fixture.password);
  const character = characters.find(c => c.name === fixture.name);
  assert.ok(character, 'Character must survive container restart');
  await session.enter(character.index);
  assert.equal(session.user.gold, fixture.gold, 'Gold must survive container restart');
  assert.equal(session.user.level, fixture.level, 'Level must survive container restart');
  assert.equal(session.user.experience, fixture.experience, 'Experience must survive container restart');
  assert.deepEqual(session.user.location, fixture.location, 'Location must survive container restart');
  assert.ok(session.user.equipment[0], 'Equipped weapon must survive container restart');
  assert.equal(session.user.equipment[0].itemIndex, fixture.weaponIndex);
  console.log('PASS: account, character, coordinates, gold, experience, level and equipment survived Docker restart.');
} finally { await session.close(); }
