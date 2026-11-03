/**
 * The amount a transfer row shows (lib/history/transfer-amount.ts).
 *
 * - Given one total, every reading from nothing to all of it renders at one width and in the
 *   total's unit, so the line does not move as the bytes count up and never reads
 *   "900 KB / 1.2 MB".
 * - Given a total just short of a unit's end, it reads in the next unit rather than as 1024 of
 *   this one.
 * - Given no total yet, there is no amount to show.
 */
import { describe, expect, it } from "vitest";
import { transferAmount } from "../src/lib/history/transfer-amount";

describe("the transfer amount", () => {
  it.each([
    [900, "B"],
    [389_120, "KB"],
    [10_066_329, "MB"],
    [3_221_225_472, "GB"],
  ])("for a total of %i bytes every reading renders at one width, in %s", (total, unit) => {
    const readings = [0, 1, 0.31, 0.5, 0.99, 1].map((share) =>
      transferAmount(Math.round(total * share), total),
    );
    expect(new Set(readings.map((r) => r?.length)).size).toBe(1);
    expect(readings.every((r) => r?.endsWith(` ${unit}`))).toBe(true);
  });

  it("a total just short of a unit's end reads in the next unit", () => {
    expect(transferAmount(0, 1023.7 * 1024)).toMatch(/ \/ 1\.0 MB$/);
  });

  it("has no amount before the total is known", () => {
    expect(transferAmount(0, 0)).toBeNull();
  });
});
