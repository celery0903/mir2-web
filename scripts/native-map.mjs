export function legacyMap(source) {
  if (source.subarray(0, 4).equals(Buffer.from([1, 0, 67, 35]))) {
    const width = source.readUInt16LE(4), height = source.readUInt16LE(6);
    if (!width || !height || source.length !== 8 + width * height * 26) throw new Error('Invalid converted map');
    const output = Buffer.alloc(52 + width * height * 12);
    output.writeUInt16LE(width, 0); output.writeUInt16LE(height, 2);
    for (let cell = 0; cell < width * height; cell++) {
      const from = 8 + cell * 26, to = 52 + cell * 12;
      const back = source.readUInt32LE(from + 2);
      output.writeUInt16LE((back & 0x7fff) | (back & 0x20000000 ? 0x8000 : 0), to);
      output.writeUInt16LE(source.readUInt16LE(from + 8), to + 2);
      output.writeUInt16LE(source.readUInt16LE(from + 12), to + 4);
      source.copy(output, to + 6, from + 14, from + 18);
      output[to + 11] = source[from + 25];
    }
    return output;
  }
  if (source.length < 52 || source.length !== 52 + source.readUInt16LE(0) * source.readUInt16LE(2) * 12) throw new Error('Invalid legacy map');
  return Buffer.from(source);
}

export function collisionRows(map) {
  const width = map.readUInt16LE(0), height = map.readUInt16LE(2);
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => {
    const at = 52 + (x * height + y) * 12;
    return (map.readUInt16LE(at) | map.readUInt16LE(at + 4)) & 0x8000 ? '1' : '0';
  }).join(''));
}
