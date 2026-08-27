/**
 * The composer's automatic image compression, in the parts that hold no DOM (lib/image-compress).
 *
 * Two decisions live here and both are ones a canvas cannot be asked about: whether a pick is one
 * to re-encode at all, and what dimensions the re-encode targets. The encode itself is the
 * browser's and is not exercised — what these tests protect is that an animated or vector image
 * is never handed to it, and that fitting an image inside the box cannot produce a zero-pixel
 * canvas.
 */
import { describe, expect, it } from "vitest";
import { IMAGE_MAX_EDGE, MB_BYTES, fitWithin, shouldCompress } from "../src/lib/image-compress";

const ON = { imageCompression: true, imageCompressionOverMb: 4 };

const image = (type: string, mb: number) => ({ type, size: Math.round(mb * MB_BYTES) });

describe("shouldCompress", () => {
  it("takes an image over the threshold and leaves one at or under it alone", () => {
    // `>`, not `>=`: the number an admin types reads as "larger than this", which is how the
    // form words it — an image of exactly the threshold has to go up untouched.
    expect(shouldCompress(image("image/jpeg", 5), ON)).toBe(true);
    expect(shouldCompress(image("image/jpeg", 4), ON)).toBe(false);
    expect(shouldCompress(image("image/jpeg", 3.9), ON)).toBe(false);
  });

  it("never touches a format a canvas round trip would change", () => {
    // An animated GIF comes back as its first frame and an SVG comes back rasterized: for both,
    // "smaller" would mean "a different picture", which is not this feature's to decide.
    expect(shouldCompress(image("image/gif", 40), ON)).toBe(false);
    expect(shouldCompress(image("image/svg+xml", 40), ON)).toBe(false);
    expect(shouldCompress(image("image/avif", 40), ON)).toBe(false);
    expect(shouldCompress(image("image/png", 40), ON)).toBe(true);
    expect(shouldCompress(image("image/webp", 40), ON)).toBe(true);
  });

  it("does nothing at all while the switch is off", () => {
    const off = { imageCompression: false, imageCompressionOverMb: 1 };
    expect(shouldCompress(image("image/jpeg", 200), off)).toBe(false);
  });
});

describe("fitWithin", () => {
  it("leaves an image already inside the box at its own dimensions", () => {
    expect(fitWithin(1920, 1080, IMAGE_MAX_EDGE)).toEqual({ width: 1920, height: 1080 });
    expect(fitWithin(IMAGE_MAX_EDGE, 10, IMAGE_MAX_EDGE)).toEqual({
      width: IMAGE_MAX_EDGE,
      height: 10,
    });
  });

  it("scales the longest edge to the box and keeps the aspect ratio", () => {
    expect(fitWithin(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(3024, 4032, 2048)).toEqual({ width: 1536, height: 2048 });
  });

  it("keeps a very thin image at least one pixel wide", () => {
    // A 4000x1 strip scaled by 2048/4000 rounds its short edge to 0, which is a canvas with no
    // pixels rather than a smaller picture.
    expect(fitWithin(4000, 1, 2048)).toEqual({ width: 2048, height: 1 });
  });
});
