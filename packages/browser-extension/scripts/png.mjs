// A small PNG codec on node:zlib, enough for the extension's icons and the e2e's screenshot:
// decodes 8-bit RGB/RGBA non-interlaced images, encodes RGBA, resamples by area and greys an
// image out. No dependency, so the build stays `esbuild` plus Node.
import { crc32, deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** @returns {{ width: number, height: number, rgba: Buffer }} */
export function decodePng(file) {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString("latin1", offset + 4, offset + 8);
    const data = file.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const [depth, colorType, , , interlace] = data.subarray(8, 13);
      if (depth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
        throw new Error("only 8-bit, non-interlaced RGB or RGBA PNGs are supported");
      }
      channels = colorType === 6 ? 4 : 3;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[y * stride + x] = value & 0xff;
    }
  }
  if (channels === 4) return { width, height, rgba: pixels };
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels.copy(rgba, i * 4, i * 3, i * 3 + 3);
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** RGBA → PNG (filter 0 on every line). */
export function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Area-average resampling with premultiplied alpha, so edges do not darken. */
export function resize({ width, height, rgba }, size) {
  const out = Buffer.alloc(size * size * 4);
  const sx = width / size;
  const sy = height / size;
  for (let oy = 0; oy < size; oy++) {
    for (let ox = 0; ox < size; ox++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let area = 0;
      const x0 = ox * sx;
      const x1 = x0 + sx;
      const y0 = oy * sy;
      const y1 = y0 + sy;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const w = wy * (Math.min(x + 1, x1) - Math.max(x, x0));
          const i = (y * width + x) * 4;
          const alpha = rgba[i + 3] / 255;
          r += rgba[i] * alpha * w;
          g += rgba[i + 1] * alpha * w;
          b += rgba[i + 2] * alpha * w;
          a += alpha * w;
          area += w;
        }
      }
      const o = (oy * size + ox) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round((a / area) * 255);
    }
  }
  return { width: size, height: size, rgba: out };
}

/** The idle look: luminance only, a little lighter, a little faded. */
export function greyOut({ width, height, rgba }) {
  const out = Buffer.from(rgba);
  for (let i = 0; i < out.length; i += 4) {
    const lum = 0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2];
    const grey = Math.round(96 + lum * 0.55);
    out[i] = grey;
    out[i + 1] = grey;
    out[i + 2] = grey;
    out[i + 3] = Math.round(out[i + 3] * 0.85);
  }
  return { width, height, rgba: out };
}
