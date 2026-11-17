// Generates the app icons: a pixel-art anvil with a glowing blade on a dark forge background.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
const ART = [
  '................',
  '.......ff.......',
  '.......ff.......',
  '.......ff.......',
  '.......ff.......',
  '.......ff.......',
  '.......ff.......',
  '.....gggggg.....',
  '.......hh.......',
  '.aaaaaaaaaaaaa..',
  'aaAAAAAAAAAAAAa.',
  '.aaAAAAAAAAAAa..',
  '....aAAAAAa.....',
  '....aAAAAAa.....',
  '...aaAAAAAaa....',
  '..aaaaaaaaaaa...',
];
const PAL = { '.': null, f: [255, 190, 96], g: [216, 170, 80], h: [122, 74, 42], a: [48, 48, 58], A: [92, 92, 106] };
const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
function icon(size, inset) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const art = Math.floor((size * (1 - inset * 2)) / 16) * 16, cell = art / 16, off = Math.floor((size - art) / 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - size / 2, y - size * 0.62) / size;
      let rgb = [26 + Math.max(0, 70 * (1 - d * 2.2)), 18 + Math.max(0, 28 * (1 - d * 2.2)), 16 + Math.max(0, 8 * (1 - d * 2.2))];
      const ax = Math.floor((x - off) / cell), ay = Math.floor((y - off) / cell);
      if (ax >= 0 && ay >= 0 && ax < 16 && ay < 16) { const p = PAL[ART[ay][ax]]; if (p) rgb = p; }
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = rgb[0]; raw[i + 1] = rgb[1]; raw[i + 2] = rgb[2]; raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const out = process.argv[2];
writeFileSync(`${out}/icon-192.png`, icon(192, 0.08));
writeFileSync(`${out}/icon-512.png`, icon(512, 0.08));
writeFileSync(`${out}/icon-maskable-512.png`, icon(512, 0.2));
writeFileSync(`${out}/apple-touch-icon.png`, icon(180, 0.1));
