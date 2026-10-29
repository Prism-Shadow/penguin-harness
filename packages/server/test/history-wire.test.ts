/**
 * The machine leg's `have=` on the wire (services/history-wire.ts).
 *
 * - Given an inode past 2^53 (an NTFS file id), it travels as a decimal string and comes back
 *   exactly, told apart from its neighbour — a JSON number would have made the two one.
 * - Given every run a hub holds of a file, they all come back; given the single-run form a hub
 *   sent before runs, its one run comes back the same way.
 * - Given a key that is not an Agent/Session/file triple of ids (`..` in it), nothing decodes.
 */
import { describe, expect, it } from "vitest";
import type { HistoryHave } from "../src/api/types.js";
import { decodeHistoryHave, encodeHistoryHave } from "../src/services/history-wire.js";

const run = (lo: number, hi: number) => ({ lo, loOrd: lo / 10, hi, loAnchor: "l", hiAnchor: "h" });

describe("have on the wire", () => {
  it("an inode past 2^53 comes back exactly, apart from its neighbour", () => {
    const big = (2n ** 60n + 4096n).toString();
    const next = (2n ** 60n + 4097n).toString();
    const have: HistoryHave[] = [
      { k: "a/s/1", ino: big, dev: "66306", birthtimeMs: 1, ranges: [] },
      { k: "a/s/2", ino: next, birthtimeMs: 1, ranges: [] },
    ];
    const back = decodeHistoryHave(encodeHistoryHave(have))!;
    expect(back.map((h) => h.ino)).toEqual([big, next]);
    expect(back[0]!.dev).toBe("66306");
    expect(Number(big)).toBe(Number(next)); // what a number would have carried
  });

  it("every held run comes back, and so does the single run of the older form", () => {
    const many: HistoryHave = {
      k: "a/s/1",
      ino: "7",
      birthtimeMs: 1,
      ranges: [run(0, 40), run(90, 200)],
    };
    expect(decodeHistoryHave(encodeHistoryHave([many]))![0]!.ranges).toEqual([
      run(0, 40),
      run(90, 200),
    ]);
    const single = { k: "a/s/1", ino: 7, birthtimeMs: 1, ...run(90, 200) };
    const raw = Buffer.from(JSON.stringify([single])).toString("base64url");
    expect(decodeHistoryHave(raw)).toEqual([
      { k: "a/s/1", ino: "7", birthtimeMs: 1, ranges: [run(90, 200)] },
    ]);
  });

  it("a key that is not three ids decodes to nothing", () => {
    const bad = { k: "../s/1", ino: "7", birthtimeMs: 1, ranges: [] };
    expect(decodeHistoryHave(Buffer.from(JSON.stringify([bad])).toString("base64url"))).toBeNull();
  });
});
