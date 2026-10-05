import assert from 'node:assert/strict';
import { test } from 'node:test';
import { legacyMap, legacyTileRemap, collisionRows, archivedMapPins } from '../scripts/native-map.mjs';

function crystalMap(frontLibrary) {
  const source = Buffer.alloc(8 + 4 * 26);
  source.set([1, 0, 67, 35]);
  source.writeUInt16LE(2, 4); source.writeUInt16LE(2, 6);
  const at = 8;
  source.writeUInt32LE(0x20000003, at + 2);
  source.writeInt16LE(1, at + 6);
  source.writeUInt16LE(9, at + 8);
  source.writeInt16LE(frontLibrary, at + 10);
  source.writeUInt16LE(0x8000 | 311, at + 12);
  source.set([2, 3, 4, 5], at + 14);
  source[at + 25] = 7;
  return source;
}

test('archived map pins retain the original seed provenance and refuse an unpinned override', () => {
  const world = { repository: 'seed', revision: 'revision', maps: [
    { id: '0', sha256: 'bichon' }, { id: '5', sourceFile: '5.map', sha256: 'seed-map', gitBlob: 'blob', bytes: 9 }
  ] };
  const archive = { archive: 'archive', installer: { sha256: 'installer' },
    maps: [{ id: '5', file: 'map/5.map' }], clientFiles: [{ file: 'map/5.map', bytes: 12, sha256: 'original-map' }] };
  const result = archivedMapPins(world, archive);
  assert.equal(result[0], world.maps[0]);
  assert.equal(result[1].sha256, 'original-map');
  assert.equal(result[1].sourceFile, 'map/5.map');
  assert.equal(result[1].sourceKind, 'archived-client');
  assert.equal(result[1].gitBlob, undefined);
  assert.deepEqual(result[1].previousSource, { repository: 'seed', revision: 'revision',
    file: '5.map', sha256: 'seed-map', gitBlob: 'blob' });
  assert.equal(world.maps[1].sha256, 'seed-map');
  assert.throws(() => archivedMapPins(world, { ...archive, clientFiles: [] }), /Unpinned archived map/);
});

test('non-default front library survives conversion without changing collision or door data', () => {
  const converted = legacyMap(crystalMap(24));
  assert.equal(converted.readUInt16LE(52), 0x8003);
  assert.equal(converted.readUInt16LE(54), 9);
  assert.equal(converted.readUInt16LE(56), 0x8000 | 311);
  assert.deepEqual([...converted.subarray(58, 62)], [2, 3, 4, 5]);
  assert.equal(converted[62], 22);
  assert.equal(converted[63], 7);
  assert.deepEqual(collisionRows(converted), ['10', '00']);
});

test('default and highest representable front libraries retain their own file indices', () => {
  assert.equal(legacyMap(crystalMap(2))[62], 0);
  assert.equal(legacyMap(crystalMap(257))[62], 255);
});

test('unrepresentable front libraries are rejected instead of silently merged', () => {
  for (const index of [-1, 1, 258]) assert.throws(() => legacyMap(crystalMap(index)), /Unsupported front library/);
});

test('legacy maps preserve their library byte and all other cell bytes', () => {
  const map = legacyMap(crystalMap(24));
  assert.deepEqual(legacyMap(map), map);
});

test('ambiguous 14-byte layouts are rejected unless a tail size is explicitly supplied', () => {
  const map = Buffer.alloc(52 + 6 * 14);
  map.writeUInt16LE(2, 0); map.writeUInt16LE(3, 2);
  assert.throws(() => legacyMap(map), /Invalid legacy map/);
  assert.throws(() => legacyMap(map, { trailingBytes: 24 }), /Invalid legacy map/);
  assert.deepEqual(legacyMap(map, { trailingBytes: 12 }), map);
});

test('wide tile image ids receive distinct free slots without aliasing existing terrain', () => {
  const source = crystalMap(24);
  source.writeUInt32LE(0x20000000 | 72339, 10);
  source.writeUInt32LE(1, 8 + 26 + 2);
  source.writeUInt32LE(72338, 8 + 52 + 2);
  source.writeUInt32LE(72339, 8 + 78 + 2);
  assert.deepEqual(legacyTileRemap(source), { 72338: 2, 72339: 3 });
  const map = legacyMap(source);
  assert.equal(map.readUInt16LE(52), 0x8003);
  assert.equal(map.readUInt16LE(64), 1);
  assert.equal(map.readUInt16LE(76), 2);
  assert.equal(map.readUInt16LE(88), 3);
  assert.deepEqual(collisionRows(map), ['10', '00']);
});
