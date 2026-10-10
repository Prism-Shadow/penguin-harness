/**
 * image-facts: the pixel size read from each format's header (PNG IHDR, GIF logical screen,
 * the JPEG start-of-frame behind other segments, WebP VP8 / VP8L / VP8X), and the one-line
 * description of an image URL that read_file and the refused-image note print.
 */
import { describe, expect, it } from "vitest";
import { describeImageUrl, imageDimensions } from "../src/omnimessage/index.js";

const bytes = (...parts: (string | number[])[]): Uint8Array =>
  Buffer.concat(
    parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(p))),
  );
const be16 = (n: number) => [n >> 8, n & 0xff];
const be32 = (n: number) => [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const le16 = (n: number) => [n & 0xff, n >> 8];
const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, n >> 16];
const le32 = (n: number) => [...le16(n & 0xffff), ...le16(n >>> 16)];

/** APP0 (JFIF) and APP1 (EXIF) segments before the frame header, as cameras write them. */
const jpeg = (sof: number, w: number, h: number) =>
  bytes(
    [0xff, 0xd8],
    [0xff, 0xe0, ...be16(16)],
    "JFIF\0",
    Array<number>(9).fill(0),
    [0xff, 0xe1, ...be16(8)],
    "Exif\0\0",
    [0xff, sof, ...be16(17), 8, ...be16(h), ...be16(w), 3],
    Array<number>(9).fill(0),
  );
const webp = (chunk: string, payload: number[]) =>
  bytes("RIFF", le32(12 + payload.length), "WEBP", chunk, le32(payload.length), payload);

/** A real 1×1 PNG. */
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("imageDimensions", () => {
  it.each([
    {
      name: "PNG",
      data: bytes([0x89], "PNG\r\n\x1a\n", be32(13), "IHDR", be32(750), be32(8618)),
      dims: { width: 750, height: 8618 },
    },
    {
      name: "GIF",
      data: bytes("GIF89a", le16(320), le16(200), [0, 0, 0]),
      dims: { width: 320, height: 200 },
    },
    { name: "baseline JPEG", data: jpeg(0xc0, 1920, 1080), dims: { width: 1920, height: 1080 } },
    { name: "progressive JPEG", data: jpeg(0xc2, 640, 4000), dims: { width: 640, height: 4000 } },
    {
      name: "WebP VP8",
      data: webp("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(1024), ...le16(768)]),
      dims: { width: 1024, height: 768 },
    },
    {
      name: "WebP VP8L",
      data: webp("VP8L", [0x2f, ...le32((300 - 1) | ((5000 - 1) << 14)), 0, 0, 0, 0, 0]),
      dims: { width: 300, height: 5000 },
    },
    {
      name: "WebP VP8X",
      data: webp("VP8X", [0, 0, 0, 0, ...le24(4000 - 1), ...le24(3000 - 1)]),
      dims: { width: 4000, height: 3000 },
    },
    { name: "text bytes", data: bytes("not an image at all"), dims: null },
    { name: "a PNG cut before its IHDR", data: bytes([0x89], "PNG\r\n\x1a\n"), dims: null },
  ])("reads $name", ({ data, dims }) => {
    expect(imageDimensions(data)).toEqual(dims);
  });
});

describe("describeImageUrl", () => {
  it("names format, pixel size and byte size of a data URL, and names any other URL as it is", () => {
    expect(describeImageUrl(`data:image/png;base64,${PNG_1X1}`)).toBe("image/png, 1×1 px, 70 B");
    const noImage = Buffer.from("not an image").toString("base64");
    expect(describeImageUrl(`data:image/png;base64,${noImage}`)).toBe(
      "image/png, size unreadable, 12 B",
    );
    expect(describeImageUrl("https://example.com/shot.png")).toBe(
      "image at https://example.com/shot.png",
    );
  });
});
