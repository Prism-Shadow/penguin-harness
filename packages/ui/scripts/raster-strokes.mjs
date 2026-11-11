/**
 * Renders a drawn pen line — round-capped, round-joined polylines of one width and one ink — to
 * a small palette PNG, for `draw-doodle-edges.mjs`. A box's line is a `border-image`; drawn from
 * an SVG it is re-rasterised for every slice of every box on every repaint, drawn from a bitmap it
 * is a scaled copy, which is what keeps a long transcript's raster time near a plain border's.
 *
 * Coverage is exact geometry, sampled: each pixel holds SAMPLES × SAMPLES points, a point is ink
 * when it lies within half the pen's width of any segment (which gives round caps and joins for
 * free), and the pixel's alpha is the share of its points that are, in sixteen steps. The PNG
 * stores the step as a 4-bit palette index (the ink at each alpha, `tRNS`), so an image is half a
 * byte a pixel before deflate, and the same lines give the same pixels on any machine. Deflate's
 * own bytes may differ between zlib builds; `pngPixels` reads an image back to its pixels, so a
 * staleness check compares what an image shows rather than how it was compressed.
 */
import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";

/** Points per pixel along each axis, and the alpha steps the coverage is stored in (4-bit). */
const SAMPLES = 6;
const LEVELS = 15;

/**
 * The coverage of `lines` (each `{ points: [[x, y], …], closed }` in image px) stroked `width` px
 * wide on a `size` px square, rendered at `scale` device pixels per px: one alpha level 0–15 a pixel.
 */
export function rasterize({ size, scale, width, lines }) {
  const side = size * scale;
  const grid = side * SAMPLES;
  const hit = new Uint8Array(grid * grid);
  const reach = (width * scale) / 2;
  const reach2 = reach * reach;
  for (const { points, closed } of lines) {
    const pts = points.map(([x, y]) => [x * scale, y * scale]);
    const count = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < count; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const length2 = dx * dx + dy * dy;
      const fromX = Math.max(0, Math.floor((Math.min(x0, x1) - reach) * SAMPLES));
      const toX = Math.min(grid - 1, Math.ceil((Math.max(x0, x1) + reach) * SAMPLES));
      const fromY = Math.max(0, Math.floor((Math.min(y0, y1) - reach) * SAMPLES));
      const toY = Math.min(grid - 1, Math.ceil((Math.max(y0, y1) + reach) * SAMPLES));
      for (let sy = fromY; sy <= toY; sy++) {
        const py = (sy + 0.5) / SAMPLES;
        for (let sx = fromX; sx <= toX; sx++) {
          const px = (sx + 0.5) / SAMPLES;
          // The nearest point of the segment, then the distance to it.
          const t =
            length2 === 0
              ? 0
              : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / length2));
          const ex = px - (x0 + t * dx);
          const ey = py - (y0 + t * dy);
          if (ex * ex + ey * ey <= reach2) hit[sy * grid + sx] = 1;
        }
      }
    }
  }
  const levels = new Uint8Array(side * side);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      let sum = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        const row = (y * SAMPLES + sy) * grid + x * SAMPLES;
        for (let sx = 0; sx < SAMPLES; sx++) sum += hit[row + sx];
      }
      levels[y * side + x] = Math.round((sum * LEVELS) / (SAMPLES * SAMPLES));
    }
  }
  return { side, levels };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/** A rasterised line as a palette PNG in `ink` (`#rrggbb`), alpha from its coverage. */
export function encodePng({ side, levels }, ink) {
  const rgb = [1, 3, 5].map((at) => Number.parseInt(ink.slice(at, at + 2), 16));
  const palette = Buffer.alloc((LEVELS + 1) * 3);
  // The last entry is the ink at full strength, which a short `tRNS` leaves opaque.
  const alpha = Buffer.alloc(LEVELS);
  for (let level = 0; level <= LEVELS; level++) {
    palette.set(rgb, level * 3);
    if (level < LEVELS) alpha[level] = Math.round((255 * level) / LEVELS);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header[8] = 4; // bit depth
  header[9] = 3; // palette colour
  // Each row: the filter byte (none), then two pixels a byte, high nibble first.
  const stride = Math.ceil(side / 2) + 1;
  const raw = Buffer.alloc(side * stride);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const at = y * stride + 1 + (x >> 1);
      raw[at] |= levels[y * side + x] << (x & 1 ? 0 : 4);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("PLTE", palette),
    chunk("tRNS", alpha),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** What a PNG this module wrote shows — its header, palette and pixels — as one digest. */
export function pngPixels(png) {
  const parts = [];
  const idat = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    const type = png.toString("ascii", at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + length);
    if (type === "IDAT") idat.push(data);
    else if (type !== "IEND") parts.push(type, data);
    at += 12 + length;
  }
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  hash.update(inflateSync(Buffer.concat(idat)));
  return hash.digest("hex");
}
