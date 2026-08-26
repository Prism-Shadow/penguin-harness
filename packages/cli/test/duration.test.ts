/**
 * `--timeout` duration parsing: `30s` / `5m` / `2h` and bare integers (seconds); every
 * other shape is rejected so the commands can print the localized error.
 */
import { describe, expect, it } from "vitest";
import { parseDurationMs } from "../src/duration.js";

describe("parseDurationMs", () => {
  it("accepts the documented shapes", () => {
    expect(parseDurationMs("30s")).toBe(30_000);
    expect(parseDurationMs("5m")).toBe(300_000);
    expect(parseDurationMs("2h")).toBe(7_200_000);
    expect(parseDurationMs("45")).toBe(45_000); // bare integer = seconds
    expect(parseDurationMs(" 1s ")).toBe(1000); // trimmed
  });

  it("rejects everything else", () => {
    for (const bad of ["", "0", "0s", "-5s", "1.5m", "5 m", "5d", "m", "5ms", "abc", "1h30m"]) {
      expect(parseDurationMs(bad)).toBeNull();
    }
  });
});
