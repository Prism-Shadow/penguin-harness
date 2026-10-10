/**
 * The facts of an image a model can act on — its format, its pixel size and its byte size —
 * read from the bytes alone, so the same one-line description can travel with the image
 * (read_file's output line) and stand in for it once a provider has refused it (see
 * rejected-images.ts).
 *
 * Dimensions come from the format's own header: the PNG IHDR chunk, the GIF logical screen,
 * the first JPEG start-of-frame segment, and the WebP VP8 / VP8L / VP8X chunk. Nothing here
 * decodes pixels, and nothing knows any model's limits.
 *
 * Runs in the browser as well as in Node (the Web App imports this package's omnimessage
 * entry), so base64 is decoded with `atob` and bytes are plain `Uint8Array`s.
 */

/** Width and height in pixels. */
export interface ImageDimensions {
  width: number;
  height: number;
}

/** Base64 characters decoded when looking for a header: a JPEG's start-of-frame can sit behind large EXIF segments. */
const HEADER_SCAN_BASE64_CHARS = 1024 * 1024;

const be16 = (b: Uint8Array, i: number): number => (b[i]! << 8) | b[i + 1]!;
const le16 = (b: Uint8Array, i: number): number => b[i]! | (b[i + 1]! << 8);
const le24 = (b: Uint8Array, i: number): number => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const be32 = (b: Uint8Array, i: number): number => be16(b, i) * 65536 + be16(b, i + 2);
const ascii = (b: Uint8Array, i: number, s: string): boolean =>
  [...s].every((c, k) => b[i + k] === c.charCodeAt(0));

/** JPEG start-of-frame markers (baseline, progressive, lossless, arithmetic); C4, C8 and CC are not frames. */
const JPEG_SOF = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function jpegDimensions(b: Uint8Array): ImageDimensions | null {
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    // Fill bytes before a marker.
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    // End of image or start of scan before any frame header: nothing to read.
    if (marker === 0xd9 || marker === 0xda) return null;
    if (JPEG_SOF.has(marker)) {
      if (i + 8 >= b.length) return null;
      return { height: be16(b, i + 5), width: be16(b, i + 7) };
    }
    i += 2 + be16(b, i + 2);
  }
  return null;
}

function webpDimensions(b: Uint8Array): ImageDimensions | null {
  if (b.length < 30) return null;
  if (ascii(b, 12, "VP8 ")) {
    return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
  }
  if (ascii(b, 12, "VP8L")) {
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (ascii(b, 12, "VP8X")) {
    return { width: le24(b, 24) + 1, height: le24(b, 27) + 1 };
  }
  return null;
}

/**
 * The pixel size an image's header declares, or null when the bytes are none of PNG, GIF,
 * JPEG or WebP or the header is cut short.
 */
export function imageDimensions(bytes: Uint8Array): ImageDimensions | null {
  const b = bytes;
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, "PNG") && ascii(b, 12, "IHDR")) {
    return { width: be32(b, 16), height: be32(b, 20) };
  }
  if (b.length >= 10 && ascii(b, 0, "GIF8")) {
    return { width: le16(b, 6), height: le16(b, 8) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return jpegDimensions(b);
  }
  if (b.length >= 12 && ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP")) {
    return webpDimensions(b);
  }
  return null;
}

/** A byte count for people and models alike: `512 B`, `960.6 kB`, `5.0 MB`. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} kB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * An image in one line: `image/png, 750×8618 px, 960.6 kB` — the pixel part says
 * `size unreadable` when the header yields none (bytes that are no image they claim to be).
 */
export function describeImageBytes(mime: string, bytes: Uint8Array): string {
  return describeImage(mime, imageDimensions(bytes), bytes.length);
}

function describeImage(mime: string, dims: ImageDimensions | null, size: number): string {
  const pixels = dims ? `${dims.width}×${dims.height} px` : "size unreadable";
  return `${mime}, ${pixels}, ${formatSize(size)}`;
}

/**
 * The one-line description of an image as a message carries it: a `data:` URL is described
 * from its bytes (only the head is decoded for the header; the byte size comes from the
 * base64 length), any other URL is named as it is.
 */
export function describeImageUrl(url: string): string {
  const match = /^data:([^;,]+);base64,/.exec(url);
  if (!match) return `image at ${url}`;
  const body = url.slice(match[0].length);
  const padding = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0;
  const size = Math.max(0, Math.floor((body.length * 3) / 4) - padding);
  let dims: ImageDimensions | null = null;
  try {
    const head = body.slice(0, Math.min(body.length, HEADER_SCAN_BASE64_CHARS) & ~3);
    const binary = atob(head);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    dims = imageDimensions(bytes);
  } catch {
    // Not valid base64: described without a pixel size.
  }
  return describeImage(match[1]!, dims, size);
}
