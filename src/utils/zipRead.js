import fs from 'node:fs';
import zlib from 'node:zlib';

/**
 * Minimal streaming ZIP reader (no dependencies, works on Windows). Enough for the council INSPIRE downloads:
 * stored or deflated entries, archives under 4 GB. Reads the central directory, then streams one entry at a time.
 */
const u16 = (b, o) => b.readUInt16LE(o), u32 = (b, o) => b.readUInt32LE(o);

export async function listZip(file) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    let e = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('Not a ZIP file (end-of-archive record not found).');
    const count = u16(tail, e + 10), cdSize = u32(tail, e + 12), cdOff = u32(tail, e + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) throw new Error('ZIP64 archives are not supported - unzip the file first and import the .gml.');
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOff);
    const entries = [];
    for (let o = 0, i = 0; i < count && o + 46 <= cd.length; i++) {
      if (u32(cd, o) !== 0x02014b50) throw new Error('Corrupt ZIP directory.');
      const nameLen = u16(cd, o + 28), extraLen = u16(cd, o + 30), commentLen = u16(cd, o + 32);
      entries.push({ name: cd.toString('utf8', o + 46, o + 46 + nameLen), method: u16(cd, o + 10), compressedSize: u32(cd, o + 20), size: u32(cd, o + 24), offset: u32(cd, o + 42) });
      o += 46 + nameLen + extraLen + commentLen;
    }
    return entries.filter((x) => !x.name.endsWith('/'));
  } finally { await fh.close(); }
}

/** Readable stream of one entry's (decompressed) bytes. */
export async function openZipEntry(file, entry) {
  const fh = await fs.promises.open(file, 'r');
  let start;
  try {
    const head = Buffer.alloc(30);
    await fh.read(head, 0, 30, entry.offset);
    if (u32(head, 0) !== 0x04034b50) throw new Error('Corrupt ZIP entry header.');
    start = entry.offset + 30 + u16(head, 26) + u16(head, 28);
  } finally { await fh.close(); }
  const raw = fs.createReadStream(file, { start, end: start + entry.compressedSize - 1 });
  if (entry.method === 0) return raw;
  if (entry.method !== 8) throw new Error(`Unsupported ZIP compression method ${entry.method}.`);
  const inflate = zlib.createInflateRaw();
  raw.on('error', (e) => inflate.destroy(e));
  return raw.pipe(inflate);
}
