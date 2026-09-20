import { deflateSync } from "node:zlib";

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const result = Buffer.alloc(4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
  return result;
}

function chunk(type: string, data: Buffer) {
  const typeBytes = Buffer.from(type, "ascii");
  return Buffer.concat([Buffer.alloc(4), typeBytes, data, crc32(Buffer.concat([typeBytes, data]))]);
}

export function imagePng(width = 1, height = 1, rgba = [30, 100, 220, 255]) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0)
    throw new Error("invalid fixture dimensions");
  if (
    rgba.length !== 4 ||
    rgba.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  )
    throw new Error("invalid fixture color");
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rowLength = width * 4 + 1;
  const raw = Buffer.concat(Array.from({ length: height }, () => Buffer.alloc(rowLength)));
  for (let y = 0; y < height; y++) {
    raw[y * rowLength] = 0;
    for (let x = 0; x < width; x++) Buffer.from(rgba).copy(raw, y * rowLength + 1 + x * 4);
  }
  const idat = deflateSync(raw);
  const ihdrChunk = chunk("IHDR", ihdr);
  ihdrChunk.writeUInt32BE(ihdr.length, 0);
  const idatChunk = chunk("IDAT", idat);
  idatChunk.writeUInt32BE(idat.length, 0);
  const iendChunk = chunk("IEND", Buffer.alloc(0));
  iendChunk.writeUInt32BE(0, 0);
  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}
