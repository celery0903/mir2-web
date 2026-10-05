export function legacyTileRemap(source) {
  if (!source.subarray(0, 4).equals(Buffer.from([1, 0, 67, 35]))) return {};
  const width = source.readUInt16LE(4), height = source.readUInt16LE(6);
  if (!width || !height || source.length !== 8 + width * height * 26) throw new Error('Invalid converted map');
  const used = new Set(), extended = new Set();
  for (let cell = 0; cell < width * height; cell++) {
    const image = source.readUInt32LE(8 + cell * 26 + 2) & 0x1fffffff;
    if (image >= 0x7f00) extended.add(image);
    else if (image) used.add(image);
  }
  const remap = {};
  let next = 1;
  for (const image of [...extended].sort((a, b) => a - b)) {
    while (used.has(next)) next++;
    if (next >= 0x7f00) throw new Error('Too many tile images for the legacy map format');
    remap[image] = next;
    used.add(next++);
  }
  return remap;
}

export function legacyMap(source, { trailingBytes = 0 } = {}) {
  if (!Number.isSafeInteger(trailingBytes) || trailingBytes < 0) throw new Error('Invalid pinned auxiliary tail size');
  if (source.subarray(0, 4).equals(Buffer.from([1, 0, 67, 35]))) {
    const width = source.readUInt16LE(4), height = source.readUInt16LE(6);
    if (!width || !height || source.length !== 8 + width * height * 26) throw new Error('Invalid converted map');
    const output = Buffer.alloc(52 + width * height * 12);
    const tileRemap = legacyTileRemap(source);
    output.writeUInt16LE(width, 0); output.writeUInt16LE(height, 2);
    for (let cell = 0; cell < width * height; cell++) {
      const from = 8 + cell * 26, to = 52 + cell * 12;
      const back = source.readUInt32LE(from + 2);
      const image = back & 0x1fffffff;
      output.writeUInt16LE((tileRemap[image] ?? image) | (back & 0x20000000 ? 0x8000 : 0), to);
      output.writeUInt16LE(source.readUInt16LE(from + 8), to + 2);
      output.writeUInt16LE(source.readUInt16LE(from + 12), to + 4);
      source.copy(output, to + 6, from + 14, from + 18);
      const frontLibrary = source.readInt16LE(from + 10);
      const frontImage = source.readUInt16LE(from + 12) & 0x7fff;
      if (frontImage && frontImage < 0x7f00 && (frontLibrary < 2 || frontLibrary > 257)) throw new Error(`Unsupported front library: ${frontLibrary}`);
      if (frontLibrary >= 2 && frontLibrary <= 257) output[to + 10] = frontLibrary - 2;
      output[to + 11] = source[from + 25];
    }
    return output;
  }
  if (source.length < 52 || source.length !== 52 + source.readUInt16LE(0) * source.readUInt16LE(2) * 12 + trailingBytes) throw new Error('Invalid legacy map');
  return Buffer.from(source);
}

export function collisionRows(map) {
  const width = map.readUInt16LE(0), height = map.readUInt16LE(2);
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => {
    const at = 52 + (x * height + y) * 12;
    return (map.readUInt16LE(at) | map.readUInt16LE(at + 4)) & 0x8000 ? '1' : '0';
  }).join(''));
}

export function archivedMapPins(world, archive) {
  return world.maps.map(pin => {
    const source = archive.maps?.find(source => source.id === pin.id);
    if (!source) return pin;
    const file = archive.clientFiles.find(file => file.file === source.file);
    if (!file) throw new Error(`Unpinned archived map: ${pin.id}`);
    const { gitBlob, sourceFile, ...metadata } = pin;
    return { ...metadata, bytes: file.bytes, sha256: file.sha256, sourceFile: source.file,
      sourceKind: 'archived-client', sourceURL: archive.archive, installerSha256: archive.installer.sha256,
      previousSource: { repository: world.repository, revision: world.revision, file: sourceFile,
        sha256: pin.sha256, gitBlob } };
  });
}
