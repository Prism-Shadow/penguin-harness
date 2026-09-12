/**
 * avatar-image.ts: the crop rectangle and the format decision behind a picked avatar.
 *
 * vitest runs node-only here (`environment: "node"`, no jsdom), which is why the encoder is a
 * parameter rather than a canvas call: the rule that decides PNG-or-JPEG-or-refuse is the part
 * a user hits, and it is exercised here with a fake encoder instead of being unreachable.
 */
import { describe, expect, it } from "vitest";
import {
  AVATAR_JPEG_QUALITY,
  AVATAR_MAX_CHARS,
  AVATAR_PNG_BUDGET,
  centreCropRect,
  fitAvatarDataUrl,
} from "../src/lib/avatar-image";
import type { AvatarMimeType } from "../src/lib/avatar-image";

/** A data URL of exactly `length` characters in the given format. */
function fakeDataUrl(type: AvatarMimeType, length: number): string {
  const prefix = `data:${type};base64,`;
  return prefix + "A".repeat(Math.max(0, length - prefix.length));
}

/**
 * An encoder that answers with a fixed size per format, recording what it was asked for — the
 * two things a call site can get wrong are asking for the wrong quality and asking twice.
 */
function encoderOf(sizes: { png: number; jpeg: number }) {
  const calls: { type: AvatarMimeType; quality?: number }[] = [];
  const encode = (type: AvatarMimeType, quality?: number): string => {
    calls.push(quality === undefined ? { type } : { type, quality });
    return fakeDataUrl(type, type === "image/png" ? sizes.png : sizes.jpeg);
  };
  return { encode, calls };
}

describe("centreCropRect", () => {
  it("keeps the whole image when it is already square", () => {
    expect(centreCropRect(200, 200)).toEqual({ x: 0, y: 0, size: 200 });
  });

  it("takes the middle square of a wide image, and of a tall one", () => {
    // 400x200: a 200px square with 100px trimmed from each side.
    expect(centreCropRect(400, 200)).toEqual({ x: 100, y: 0, size: 200 });
    expect(centreCropRect(200, 400)).toEqual({ x: 0, y: 100, size: 200 });
  });

  it("rounds an odd offset rather than leaving a fractional source rectangle", () => {
    expect(centreCropRect(101, 100)).toEqual({ x: 1, y: 0, size: 100 });
  });
});

describe("fitAvatarDataUrl", () => {
  it("keeps the PNG when it is inside the budget, and asks for nothing else", () => {
    const { encode, calls } = encoderOf({ png: 1000, jpeg: 500 });
    const result = fitAvatarDataUrl(encode);
    expect(result?.startsWith("data:image/png;base64,")).toBe(true);
    // The JPEG is smaller here and is still not asked for: a small PNG is the sharper of the
    // two at 128px, so the budget decides, not the byte count.
    expect(calls).toEqual([{ type: "image/png" }]);
  });

  it("re-exports as JPEG at the fixed quality once the PNG is over budget", () => {
    const { encode, calls } = encoderOf({ png: AVATAR_PNG_BUDGET + 1, jpeg: 40000 });
    expect(fitAvatarDataUrl(encode)?.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(calls).toEqual([
      { type: "image/png" },
      { type: "image/jpeg", quality: AVATAR_JPEG_QUALITY },
    ]);
  });

  it("accepts a JPEG between the budget and the cap", () => {
    // The budget is where PNG stops being worth it; the cap is what the server takes. A JPEG in
    // between is stored, so the two numbers are not the same check.
    const { encode } = encoderOf({ png: AVATAR_MAX_CHARS, jpeg: AVATAR_MAX_CHARS });
    expect(fitAvatarDataUrl(encode)?.length).toBe(AVATAR_MAX_CHARS);
  });

  it("returns null when even the JPEG is over the cap, rather than a request certain to 400", () => {
    const { encode } = encoderOf({ png: 400000, jpeg: AVATAR_MAX_CHARS + 1 });
    expect(fitAvatarDataUrl(encode)).toBe(null);
  });
});

describe("the cap", () => {
  it("is the same number the server enforces, in the same unit", () => {
    // server/src/http/routes/me.ts rejects an avatar over 131072 CHARACTERS of data URL. Both
    // sides measuring the string rather than the decoded bytes is what keeps a picture this
    // module just accepted from being refused by the request that carries it.
    expect(AVATAR_MAX_CHARS).toBe(131072);
    expect(AVATAR_PNG_BUDGET).toBeLessThan(AVATAR_MAX_CHARS);
  });
});
