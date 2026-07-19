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

const BASE = `prompt = "做日报"\nenabled = true\nstart_at = "2026-07-16T09:00:00Z"\n`;

function defOf(raw: string) {
  const r = parseScheduleFile("daily-report", raw);
  if (!r.ok) throw new Error(r.error);
  return r.def;
}

describe("parsePeriod", () => {
  it("解析 m/h/d 固定间隔", () => {
    expect(parsePeriod("30m")).toBe(30 * 60_000);
    expect(parsePeriod("12h")).toBe(12 * 3_600_000);
    expect(parsePeriod("7d")).toBe(7 * 86_400_000);
  });
  it("非法形态返回 null", () => {
    for (const bad of ["", "5", "m30", "1.5h", "-1d", "10s", "1w"]) {
      expect(parsePeriod(bad)).toBeNull();
    }
  });
});

describe("parseScheduleFile", () => {
  it("解析全字段并保留时刻原文", () => {
    const def = defOf(
      `${BASE}period = "30m"\nend_at = "2026-07-17T09:00:00Z"\nsession_id = "session-x"\n`,
    );
    expect(def).toMatchObject({
      name: "daily-report",
      prompt: "做日报",
      enabled: true,
      startAt: "2026-07-16T09:00:00Z",
      period: "30m",
      periodMs: 30 * 60_000,
      endAt: "2026-07-17T09:00:00Z",
      sessionId: "session-x",
    });
  });

  it("enabled 缺省为不生效；period 缺省即一次性", () => {
    const def = defOf(`prompt = "p"\nstart_at = "2026-07-16T09:00:00Z"\n`);
    expect(def.enabled).toBe(false);
    expect(def.periodMs).toBeUndefined();
  });

  it("非法文件逐类拒绝", () => {
    const cases: Array<[string, string]> = [
      ["not toml ===", "TOML"],
      [`enabled = true\nstart_at = "2026-07-16T09:00:00Z"\n`, "prompt"],
      [`prompt = "p"\nenabled = "yes"\nstart_at = "2026-07-16T09:00:00Z"\n`, "enabled"],
      [`prompt = "p"\nstart_at = "someday"\n`, "start_at"],
      [`${BASE}period = "4m"\n`, "下限"],
      [`${BASE}period = "10s"\n`, "period"],
      [`${BASE}end_at = "2026-07-16T08:00:00Z"\n`, "end_at"],
      [`${BASE}session_id = "s"\nworkspace = "/tmp/w"\n`, "新建 Session 模式"],
      [`${BASE}session_id = "s"\nmodel_id = "m1"\n`, "新建 Session 模式"],
      [`${BASE}model_id = ""\n`, "model_id"],
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
  it("一次性任务的唯一时刻即 start_at", () => {
    const def = defOf(BASE);
    expect(latestSlotAt(def, start - 1)).toBeNull();
    expect(latestSlotAt(def, start)).toBe(start);
    expect(latestSlotAt(def, start + 999_999)).toBe(start);
  });
  it("周期任务自 start_at 按 period 步进", () => {
    const def = defOf(`${BASE}period = "30m"\n`);
    expect(latestSlotAt(def, start - 1)).toBeNull();
    expect(latestSlotAt(def, start)).toBe(start);
    expect(latestSlotAt(def, start + 29 * 60_000)).toBe(start);
    expect(latestSlotAt(def, start + 61 * 60_000)).toBe(start + 60 * 60_000);
  });
  it("nextSlotAfter：严格晚于 now 的下一时刻；一次性到点后无值；越过 end_at 无值", () => {
    const oneShot = defOf(BASE);
    expect(nextSlotAfter(oneShot, start - 1)).toBe(start);
    expect(nextSlotAfter(oneShot, start)).toBeNull();
    const periodic = defOf(`${BASE}period = "30m"\nend_at = "2026-07-16T10:00:00Z"\n`);
    expect(nextSlotAfter(periodic, start - 1)).toBe(start);
    expect(nextSlotAfter(periodic, start)).toBe(start + 30 * 60_000);
    expect(nextSlotAfter(periodic, start + 45 * 60_000)).toBe(start + 60 * 60_000);
    expect(nextSlotAfter(periodic, start + 60 * 60_000)).toBeNull(); // next slot passes end_at
  });

  it("end_at 窗口判定", () => {
    const def = defOf(`${BASE}period = "30m"\nend_at = "2026-07-16T10:00:00Z"\n`);
    expect(slotInWindow(def, start)).toBe(true);
    expect(slotInWindow(def, Date.parse("2026-07-16T10:00:00Z"))).toBe(true);
    expect(slotInWindow(def, Date.parse("2026-07-16T10:30:00Z"))).toBe(false);
  });
});
