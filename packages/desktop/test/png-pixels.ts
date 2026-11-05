/**
 * Just enough PNG decoding to assert what a committed icon actually looks like.
 *
 * The tray masters are generated artwork checked into the tree, so nothing else notices when a
 * re-render quietly changes what they are — a mark can come back too faint to read, or a
 * template can come back coloured, and both still load and still pass a size check. Reading the
 * pixels is the only way to hold those properties.
 *
 * Handles the one shape `scripts/render-icon.mjs` emits: 8-bit RGBA, non-interlaced. Anything
 * else throws rather than guessing, so a change in the renderer's output surfaces here instead
 * of silently weakening the assertions.
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

export interface Pixels {
  width: number;
  height: number;
  /** Straight RGBA, four bytes per pixel, row-major. */
  data: Buffer;
}

/** Undoes a scanline's filter in place, given the already-reconstructed row above it. */
function unfilter(type: number, line: Buffer, out: Buffer, prev: Buffer, bpp: number): void {
  for (let i = 0; i < line.length; i++) {
    const a = i >= bpp ? out[i - bpp]! : 0;
    const b = prev[i]!;
    const c = i >= bpp ? prev[i - bpp]! : 0;
    const x = line[i]!;
    let add: number;
    if (type === 0) add = 0;
    else if (type === 1) add = a;
    else if (type === 2) add = b;
    else if (type === 3) add = (a + b) >> 1;
    else if (type === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    } else throw new Error(`unsupported PNG filter ${type}`);
    out[i] = (x + add) & 0xff;
  }
}

/** Decodes an 8-bit RGBA PNG. */
export function readPixels(file: string): Pixels {
  const buf = readFileSync(file);
  let at = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (at < buf.length) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString("ascii", at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, colour, , , interlace] = [body[8]!, body[9]!, 0, 0, body[12]!];
      if (depth !== 8 || colour !== 6 || interlace !== 0)
        throw new Error(`expected 8-bit RGBA non-interlaced, got depth ${depth} colour ${colour}`);
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const data = Buffer.alloc(height * stride);
  let read = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[read]!;
    read += 1;
    const line = raw.subarray(read, read + stride);
    read += stride;
    const row = data.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? data.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    unfilter(filter, line, row, prev, 4);
  }
  return { width, height, data };
}

/**
 * How much of the canvas the mark actually paints, 0 to 1, counting a half-transparent pixel as
 * half — which is what the compositor does, and so what the eye gets.
 */
export function inkCoverage({ width, height, data }: Pixels): number {
  let ink = 0;
  for (let i = 3; i < data.length; i += 4) ink += data[i]! / 255;
  return ink / (width * height);
}

/** Pixels that are neither transparent nor black — none, in a macOS template image. */
export function colouredPixels({ data }: Pixels): number {
  let coloured = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 8) continue;
    if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0) coloured += 1;
  }
  return coloured;
}
