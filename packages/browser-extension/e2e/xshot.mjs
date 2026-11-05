// Grabs the whole X screen (`xwd -root`) as a PNG: the browser window as a person sees it, tab
// strip and tab groups included, which a page screenshot cannot show.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { encodePng } from "../scripts/png.mjs";

export function screenshotX(display, outPath) {
  const xwd = execFileSync("xwd", ["-root", "-silent", "-display", display], {
    maxBuffer: 256 * 1024 * 1024,
  });
  const field = (i) => xwd.readUInt32BE(i * 4);
  const headerSize = field(0);
  const width = field(4);
  const height = field(5);
  const byteOrder = field(7);
  const bitsPerPixel = field(11);
  const bytesPerLine = field(12);
  const masks = [field(14), field(15), field(16)];
  const colors = field(19);
  if (bitsPerPixel !== 32 && bitsPerPixel !== 24) {
    throw new Error(`unsupported bits per pixel: ${bitsPerPixel}`);
  }
  const bytes = bitsPerPixel / 8;
  const start = headerSize + colors * 12;
  const shift = (mask) => {
    let s = 0;
    while (mask !== 0 && (mask & 1) === 0) {
      mask >>>= 1;
      s++;
    }
    return s;
  };
  const shifts = masks.map(shift);
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = start + y * bytesPerLine + x * bytes;
      const px = byteOrder === 0 ? xwd.readUIntLE(at, bytes) : xwd.readUIntBE(at, bytes);
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) rgba[o + c] = (px & masks[c]) >>> shifts[c];
      rgba[o + 3] = 255;
    }
  }
  writeFileSync(outPath, encodePng(width, height, rgba));
}
