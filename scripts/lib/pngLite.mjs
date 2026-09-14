// A tiny, dependency-free PNG decoder — just enough to read a Playwright
// element screenshot (8-bit, non-interlaced, color type 2/RGB or 6/RGBA)
// back into raw pixel bytes, for a probe's pixel-content assertions. Used
// instead of the `pngjs` package, which isn't installed here.
import { inflateSync } from "node:zlib";

function readChunks(buf) {
  let offset = 8; // past the 8-byte PNG signature
  const chunks = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length; // length + type + data + crc
  }
  return chunks;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Decodes an 8-bit, non-interlaced RGB/RGBA PNG buffer into
 *  { width, height, channels, data } — data is a flat byte array, row-major,
 *  `channels` bytes per pixel (3 or 4). Throws on anything else (interlaced,
 *  paletted, 16-bit) — not needed for a browser screenshot. */
export function decodePNG(buf) {
  const chunks = readChunks(buf);
  const ihdr = chunks.find((c) => c.type === "IHDR").data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const interlace = ihdr[12];
  if (bitDepth !== 8) throw new Error(`pngLite: unsupported bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error("pngLite: interlaced PNG unsupported");
  let channels;
  if (colorType === 2) channels = 3;
  else if (colorType === 6) channels = 4;
  else if (colorType === 0) channels = 1;
  else throw new Error(`pngLite: unsupported color type ${colorType}`);

  const idat = Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data));
  const raw = inflateSync(idat);
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos];
    pos += 1;
    const curLine = out.subarray(y * stride, y * stride + stride);
    const prevLineOffset = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[pos + x];
      const a = x >= channels ? curLine[x - channels] : 0;
      const b = y > 0 ? out[prevLineOffset + x] : 0;
      const c = y > 0 && x >= channels ? out[prevLineOffset + x - channels] : 0;
      let val;
      switch (filter) {
        case 0:
          val = rawByte;
          break;
        case 1:
          val = (rawByte + a) & 0xff;
          break;
        case 2:
          val = (rawByte + b) & 0xff;
          break;
        case 3:
          val = (rawByte + Math.floor((a + b) / 2)) & 0xff;
          break;
        case 4:
          val = (rawByte + paeth(a, b, c)) & 0xff;
          break;
        default:
          throw new Error(`pngLite: bad filter type ${filter}`);
      }
      curLine[x] = val;
    }
    pos += stride;
  }
  return { width, height, channels, data: out };
}

function rgbToHueSat(r, g, b) {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  switch (max) {
    case rf:
      h = 60 * (((gf - bf) / d) % 6);
      break;
    case gf:
      h = 60 * ((bf - rf) / d + 2);
      break;
    default:
      h = 60 * ((rf - gf) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s };
}

/** Scans every pixel of a decoded PNG and returns the fraction (0..100) that
 *  reads as felt green (hue 150±15, saturation > 0.3) and the fraction that
 *  reads as near-white (r, g, b all > 200). */
export function scanFeltAndWhite(img) {
  const total = img.width * img.height;
  let green = 0;
  let white = 0;
  for (let i = 0; i < total; i++) {
    const o = i * img.channels;
    const r = img.data[o];
    const g = img.data[o + 1];
    const b = img.data[o + 2];
    const { h, s } = rgbToHueSat(r, g, b);
    if (Math.abs(h - 150) <= 15 && s > 0.3) green++;
    if (r > 200 && g > 200 && b > 200) white++;
  }
  return {
    total,
    greenPct: (green / total) * 100,
    whitePct: (white / total) * 100,
  };
}
