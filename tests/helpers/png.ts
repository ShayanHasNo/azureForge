import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { PixelImage } from '../../src/render/pixel';

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf: Buffer) { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function writePng(path: string, img: PixelImage, scale = 1) {
  const w = img.w * scale, h = img.h * scale;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const si = ((Math.floor(y / scale) * img.w) + Math.floor(x / scale)) * 4;
      const di = y * (w * 4 + 1) + 1 + x * 4;
      raw[di] = img.data[si]; raw[di + 1] = img.data[si + 1]; raw[di + 2] = img.data[si + 2]; raw[di + 3] = img.data[si + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
/** Lay several images side by side on a dark background. */
export function sheet(imgs: PixelImage[], bg = [40, 32, 30]): PixelImage {
  const pad = 4;
  const w = imgs.reduce((a, i) => a + i.w + pad, pad), h = Math.max(...imgs.map((i) => i.h)) + pad * 2;
  const out = new PixelImage(w, h);
  for (let k = 0; k < out.data.length; k += 4) { out.data[k] = bg[0]; out.data[k + 1] = bg[1]; out.data[k + 2] = bg[2]; out.data[k + 3] = 255; }
  let ox = pad;
  for (const img of imgs) {
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      const si = (y * img.w + x) * 4; const a = img.data[si + 3] / 255; if (!a) continue;
      const di = ((y + pad) * w + x + ox) * 4;
      for (let c = 0; c < 3; c++) out.data[di + c] = out.data[di + c] * (1 - a) + img.data[si + c] * a;
    }
    ox += img.w + pad;
  }
  return out;
}
