/**
 * The composer's pre-flight size check (lib/upload-limits).
 *
 * What matters here is agreement with the server rather than the function's own arithmetic: the
 * client refuses a pick only to save the user a pointless upload, so it must draw the line in
 * exactly the same place the server does — `>` the limit, not `>=` — and must draw it from the
 * limit it was handed rather than one of its own. A client stricter than the server silently
 * blocks legal files; a client looser than the server replaces a clear "too large" message with a
 * completed upload that dies on a generic error.
 */
import { describe, expect, it } from "vitest";
import { MB_BYTES, splitBySize } from "../src/lib/upload-limits";

const file = (name: string, size: number) => ({ name, size });

describe("composer upload size check", () => {
  it("accepts a file of exactly the limit and rejects one byte more", () => {
    // The server's check is `bytes.length > limit`, so the boundary file is legal. Pinning both
    // sides of it is the point: an off-by-one here rejects precisely the file a user just
    // resized to fit, and nothing else would reveal it.
    const limitMb = 10;
    const exact = file("exact.bin", limitMb * MB_BYTES);
    const over = file("over.bin", limitMb * MB_BYTES + 1);
    const { accepted, rejected } = splitBySize([exact, over], limitMb);
    expect(accepted).toEqual([exact]);
    expect(rejected).toEqual([over]);
  });

  it("follows the limit it is given, so a raised server limit raises the client check", () => {
    // The same 50MB file is refused under a 10MB limit and accepted under 100MB. This is the
    // behavior that makes the limit admin-settable at all: nothing in the client decides it.
    const big = file("big.zip", 50 * MB_BYTES);
    expect(splitBySize([big], 10).rejected).toEqual([big]);
    expect(splitBySize([big], 100).accepted).toEqual([big]);
  });

  it("keeps the picked order on both sides", () => {
    // Accepted order decides the chip order and therefore the order of the `[attached file: …]`
    // lines on the message, so the batch must not be reordered by the filtering.
    const a = file("a.txt", 1);
    const big = file("big.bin", 99 * MB_BYTES);
    const b = file("b.txt", 2);
    const big2 = file("big2.bin", 99 * MB_BYTES);
    const { accepted, rejected } = splitBySize([a, big, b, big2], 1);
    expect(accepted.map((f) => f.name)).toEqual(["a.txt", "b.txt"]);
    expect(rejected.map((f) => f.name)).toEqual(["big.bin", "big2.bin"]);
  });

  it("an empty batch splits into two empty sides", () => {
    expect(splitBySize([], 10)).toEqual({ accepted: [], rejected: [] });
  });
});
