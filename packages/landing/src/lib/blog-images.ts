/**
 * Pictures in blog posts: which ones a post shows as Markdown images, and how big a picture is
 * from its own bytes. The post page sizes each picture before it arrives from the sizes recorded
 * in blog-image-sizes.json (MdImage in pages/blog-post.tsx); scripts/blog-image-sizes.mjs records
 * them, and a test keeps every picture a post shows recorded. Pure, so the script (run by Node
 * straight from this file) and the tests share it.
 */

/** The sources of every Markdown image (`![alt](src "title")`) in a post's text, in order. */
export function markdownImageSources(text: string): string[] {
  return [...text.matchAll(/!\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map(
    (match) => match[1] ?? "",
  );
}

/** A picture's width and height read from its header, or null for a format not handled here. */
export function imageSize(bytes: Uint8Array): [number, number] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  const u16le = (at: number) => view.getUint16(at, true);
  const u24le = (at: number) => bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47) {
    return [view.getUint32(16), view.getUint32(20)];
  }
  if (bytes.length >= 10 && ascii(0, 4) === "GIF8") return [u16le(6), u16le(8)];
  if (bytes.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    const chunk = ascii(12, 16);
    if (chunk === "VP8 ") return [u16le(26) & 0x3fff, u16le(28) & 0x3fff];
    if (chunk === "VP8L") {
      const bits = view.getUint32(21, true);
      return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
    }
    if (chunk === "VP8X") return [u24le(24) + 1, u24le(27) + 1];
    return null;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    // JPEG: walk the segments to the frame header, which holds height then width.
    let at = 2;
    while (at + 9 < bytes.length && bytes[at] === 0xff) {
      const marker = bytes[at + 1]!;
      const frame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (frame) return [view.getUint16(at + 7), view.getUint16(at + 5)];
      at += 2 + view.getUint16(at + 2);
    }
    return null;
  }
  const head = new TextDecoder().decode(bytes.subarray(0, 4096));
  const svg = /<svg\b[^>]*>/i.exec(head)?.[0];
  if (!svg) return null;
  const length = (name: string) =>
    Number(new RegExp(`\\s${name}="([\\d.]+)(?:px)?"`).exec(svg)?.[1]);
  const box =
    /\sviewBox="([^"]+)"/
      .exec(svg)?.[1]
      ?.trim()
      .split(/[\s,]+/)
      .map(Number) ?? [];
  const width = length("width") || box[2];
  const height = length("height") || box[3];
  return width && height ? [Math.round(width), Math.round(height)] : null;
}
