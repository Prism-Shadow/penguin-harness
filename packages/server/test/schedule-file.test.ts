/**
 * Pure functions for schedule file parsing and trigger-time computation.
 */
import { describe, expect, it } from "vitest";
import {
  latestSlotAt,
  MIN_PERIOD_MS,
  nextSlotAfter,
  parsePeriod,
  parseScheduleFile,
  slotInWindow,
} from "../src/runtime/schedule-file.js";

const BASE = `prompt = "Write the daily report"\nenabled = true\nstart_at = "2026-07-16T09:00:00Z"\n`;

function defOf(raw: string) {
  const r = parseScheduleFile("daily-report", raw);
  if (!r.ok) throw new Error(r.error);
  return r.def;
}

describe("parsePeriod", () => {
  it("parses m/h/d fixed intervals", () => {
    expect(parsePeriod("30m")).toBe(30 * 60_000);
    expect(parsePeriod("12h")).toBe(12 * 3_600_000);
    expect(parsePeriod("7d")).toBe(7 * 86_400_000);
  });
  it("returns null for invalid shapes", () => {
    for (const bad of ["", "5", "m30", "1.5h", "-1d", "10s", "1w"]) {
      expect(parsePeriod(bad)).toBeNull();
    }
  });
});

describe("parseScheduleFile", () => {
  it("parses every field and preserves instant text verbatim", () => {
    const def = defOf(
      `${BASE}period = "30m"\nend_at = "2026-07-17T09:00:00Z"\nsession_id = "session-x"\n`,
    );
    expect(def).toMatchObject({
      name: "daily-report",
      prompt: "Write the daily report",
      enabled: true,
      startAt: "2026-07-16T09:00:00Z",
      period: "30m",
      periodMs: 30 * 60_000,
      endAt: "2026-07-17T09:00:00Z",
      sessionId: "session-x",
    });
  });

  it("keeps a complete model reference pair", () => {
    const def = defOf(`${BASE}provider = "custom"\nmodel_id = "m1"\n`);
    expect(def).toMatchObject({ provider: "custom", modelId: "m1" });
  });

  it("enabled defaults to off; omitting period means one-shot", () => {
    const def = defOf(`prompt = "p"\nstart_at = "2026-07-16T09:00:00Z"\n`);
    expect(def.enabled).toBe(false);
    expect(def.periodMs).toBeUndefined();
  });

  it("rejects each class of invalid file", () => {
    const cases: Array<[string, string]> = [
      ["not toml ===", "TOML"],
      [`enabled = true\nstart_at = "2026-07-16T09:00:00Z"\n`, "prompt"],
      [`prompt = "p"\nenabled = "yes"\nstart_at = "2026-07-16T09:00:00Z"\n`, "enabled"],
      [`prompt = "p"\nstart_at = "someday"\n`, "start_at"],
      [`${BASE}period = "4m"\n`, "below the 5m minimum"],
      [`${BASE}period = "10s"\n`, "period"],
      [`${BASE}end_at = "2026-07-16T08:00:00Z"\n`, "end_at"],
      [`${BASE}session_id = "s"\nworkspace = "/tmp/w"\n`, "new-Session mode"],
      [`${BASE}session_id = "s"\nmodel_id = "m1"\n`, "new-Session mode"],
      [`${BASE}model_id = ""\n`, "model_id"],
      // A model reference is always a pair: half of one is invalid in either direction
      // (model_id alone is what a file written before this rule looks like).
      [`${BASE}model_id = "m1"\n`, "given together"],
      [`${BASE}provider = "custom"\n`, "given together"],
    ];
    for (const [raw, hint] of cases) {
      const r = parseScheduleFile("x", raw);
      expect(r.ok, raw).toBe(false);
      if (!r.ok) expect(r.error).toContain(hint);
    }
    expect(MIN_PERIOD_MS).toBe(5 * 60_000);
  });
});

describe("latestSlotAt / slotInWindow", () => {
  const start = Date.parse("2026-07-16T09:00:00Z");
  it("a one-shot task's only slot is start_at itself", () => {
    const def = defOf(BASE);
    expect(latestSlotAt(def, start - 1)).toBeNull();
    expect(latestSlotAt(def, start)).toBe(start);
    expect(latestSlotAt(def, start + 999_999)).toBe(start);
  });
  it("a periodic task steps from start_at by period", () => {
    const def = defOf(`${BASE}period = "30m"\n`);
    expect(latestSlotAt(def, start - 1)).toBeNull();
    expect(latestSlotAt(def, start)).toBe(start);
    expect(latestSlotAt(def, start + 29 * 60_000)).toBe(start);
    expect(latestSlotAt(def, start + 61 * 60_000)).toBe(start + 60 * 60_000);
  });
  it("nextSlotAfter: next slot strictly after now; none after a one-shot fires or past end_at", () => {
    const oneShot = defOf(BASE);
    expect(nextSlotAfter(oneShot, start - 1)).toBe(start);
    expect(nextSlotAfter(oneShot, start)).toBeNull();
    const periodic = defOf(`${BASE}period = "30m"\nend_at = "2026-07-16T10:00:00Z"\n`);
    expect(nextSlotAfter(periodic, start - 1)).toBe(start);
    expect(nextSlotAfter(periodic, start)).toBe(start + 30 * 60_000);
    expect(nextSlotAfter(periodic, start + 45 * 60_000)).toBe(start + 60 * 60_000);
    expect(nextSlotAfter(periodic, start + 60 * 60_000)).toBeNull(); // next slot passes end_at
  });

  it("end_at window check", () => {
    const def = defOf(`${BASE}period = "30m"\nend_at = "2026-07-16T10:00:00Z"\n`);
    expect(slotInWindow(def, start)).toBe(true);
    expect(slotInWindow(def, Date.parse("2026-07-16T10:00:00Z"))).toBe(true);
    expect(slotInWindow(def, Date.parse("2026-07-16T10:30:00Z"))).toBe(false);
  });
});
