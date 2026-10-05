import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export async function loadClassicSkills() {
  const policy = JSON.parse(await readFile(new URL('../shared/classic-skills.json', import.meta.url)));
  assert.equal(policy.schemaVersion, 1);
  assert.deepEqual(policy.skills.map(skill => skill.magicId), Array.from({ length: 33 }, (_, index) => index + 1));
  assert.equal(new Set(policy.skills.map(skill => skill.name)).size, 33);
  for (const skill of policy.skills) {
    assert.ok([0, 1, 2].includes(skill.job));
    assert.match(skill.name, /^[\u4e00-\u9fff]+$/);
  }
  return policy;
}

export function classifySkills(rows, policy) {
  const retained = [], removed = [];
  for (const row of rows) {
    const skill = policy.skills.find(skill => skill.magicId === row.MagID);
    (skill && skill.name === row.MagName && skill.job === row.Job ? retained : removed).push(row);
  }
  for (const skill of policy.skills) {
    assert.equal(retained.filter(row => row.MagID === skill.magicId).length, 1, `Missing or duplicate classic skill: ${skill.magicId}/${skill.name}`);
    assert.equal(rows.filter(row => row.MagID === skill.magicId).length, 1, `Conflicting classic skill ID: ${skill.magicId}`);
  }
  return { retained, removed };
}

export function classicSkillsSql(policy) {
  const identities = policy.skills.map(skill => `(MagID=${skill.magicId} AND BINARY MagName=BINARY '${skill.name}' AND Job=${skill.job})`).join('\n    OR ');
  const ids = policy.skills.map(skill => skill.magicId).join(',');
  // Temporary CHECK guards abort the client before DELETE and roll back on disconnect.
  return `USE mir2_data;
SET NAMES utf8mb4;
START TRANSACTION;
CREATE TEMPORARY TABLE mir2_classic_skill_guard (valid TINYINT NOT NULL CHECK (valid=1));
INSERT INTO mir2_classic_skill_guard SELECT COUNT(*)=1 FROM information_schema.TABLES
  WHERE TABLE_SCHEMA='mir2_data' AND TABLE_NAME='magics' AND ENGINE='InnoDB';
INSERT INTO mir2_classic_skill_guard SELECT COUNT(*)=${policy.skills.length} AND COUNT(DISTINCT MagID)=${policy.skills.length}
  FROM magics WHERE ${identities};
INSERT INTO mir2_classic_skill_guard SELECT COUNT(*)=${policy.skills.length} FROM magics WHERE MagID IN (${ids});
INSERT INTO mir2_classic_skill_guard SELECT COUNT(*)=0 FROM mir2_db.characters_magic WHERE MagicId NOT IN (${ids});
DELETE FROM magics WHERE NOT COALESCE((${identities}),FALSE);
INSERT INTO mir2_classic_skill_guard SELECT COUNT(*)=${policy.skills.length} FROM magics;
DROP TEMPORARY TABLE mir2_classic_skill_guard;
COMMIT;
`;
}
