/**
 * format.ts unit tests: Token/duration humanized abbreviations match the CLI convention.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeTps,
  formatBytes,
  formatDateTime,
  formatMoney,
  formatPercent,
  formatRelativeDate,
  formatRelativeDays,
  formatTps,
  humanizeDuration,
  humanizeTokens,
  signedDelta,
} from "../src/lib/format";

describe("humanizeTokens", () => {
  it("below 1000 unchanged", () => {
    expect(humanizeTokens(0)).toBe("0");
    expect(humanizeTokens(999)).toBe("999");
  });

  it("thousands abbreviated, dropping a trailing .0", () => {
    expect(humanizeTokens(1000)).toBe("1k");
    expect(humanizeTokens(1234)).toBe("1.2k");
    expect(humanizeTokens(4000)).toBe("4k");
  });

  it("millions abbreviated", () => {
    expect(humanizeTokens(1_500_000)).toBe("1.5M");
    expect(humanizeTokens(2_000_000)).toBe("2M");
  });

  it("negatives keep the sign (context shrink)", () => {
    expect(humanizeTokens(-1200)).toBe("-1.2k");
    expect(humanizeTokens(-500)).toBe("-500");
  });
});

describe("humanizeDuration", () => {
  it("ms/s/min conversion", () => {
    expect(humanizeDuration(820)).toBe("820ms");
    expect(humanizeDuration(2300)).toBe("2.3s");
    expect(humanizeDuration(5100)).toBe("5.1s");
    expect(humanizeDuration(63000)).toBe("1m3s");
    expect(humanizeDuration(130000)).toBe("2m10s");
  });
});

describe("signedDelta", () => {
  it("non-negative gets +, negative already has -", () => {
    expect(signedDelta("1k")).toBe("+1k");
    expect(signedDelta("-1k")).toBe("-1k");
    expect(signedDelta("0")).toBe("+0");
  });
});

describe("formatMoney", () => {
  it("no pricing shows —", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
  });

  it("defaults to USD, decimal places scale with magnitude", () => {
    expect(formatMoney(0)).toBe("$0");
    expect(formatMoney(0.1234)).toBe("$0.1234");
    expect(formatMoney(1.5)).toBe("$1.50");
    expect(formatMoney(150)).toBe("$150");
  });

  it("CNY converted at 1:7", () => {
    expect(formatMoney(0, "CNY")).toBe("¥0");
    expect(formatMoney(1, "CNY")).toBe("¥7.00");
    expect(formatMoney(0.01, "CNY")).toBe("¥0.0700");
  });
});

describe("formatPercent", () => {
  it("rounds to a whole percent (cache hit rate)", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.714)).toBe("71%");
    expect(formatPercent(0.716)).toBe("72%");
    expect(formatPercent(1)).toBe("100%");
  });

  it("null / non-finite (zero input, hit rate undefined) shows —", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(undefined)).toBe("—");
    expect(formatPercent(Number.NaN)).toBe("—");
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatBytes", () => {
  it("byte abbreviation", () => {
    expect(formatBytes(812)).toBe("812B");
    expect(formatBytes(3481)).toBe("3.4KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2MB");
  });
});

describe("computeTps", () => {
  it("output tokens ÷ LLM seconds (known-value check)", () => {
    expect(computeTps(900, 3000)).toBe(300); // 900 / 3s
    expect(computeTps(1500, 2000)).toBe(750); // 1500 / 2s
  });

  it("llmMs ≤ 0 (no timing) returns null, avoiding division by zero", () => {
    expect(computeTps(900, 0)).toBeNull();
    expect(computeTps(900, -5)).toBeNull();
  });
});

describe("formatTps", () => {
  it("below 1000 keeps one decimal place (dropping a trailing .0)", () => {
    expect(formatTps(42.53)).toBe("42.5 tok/s");
    expect(formatTps(120)).toBe("120 tok/s");
    expect(formatTps(300)).toBe("300 tok/s");
    expect(formatTps(999.9)).toBe("999.9 tok/s");
  });

  it("1000 and above abbreviates by k / M magnitude (same convention as humanizeTokens)", () => {
    expect(formatTps(1000)).toBe("1k tok/s");
    expect(formatTps(37_783.4)).toBe("37.8k tok/s");
    expect(formatTps(1_200_000)).toBe("1.2M tok/s");
  });

  it("null / non-finite shows —", () => {
    expect(formatTps(null)).toBe("—");
    expect(formatTps(undefined)).toBe("—");
    expect(formatTps(Number.NaN)).toBe("—");
    expect(formatTps(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatRelativeDays", () => {
  // Fix "now" to local 2026-07-15 12:00; day difference is computed by local calendar day.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 15, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("same day is today, regardless of the hour", () => {
    expect(formatRelativeDays(new Date(2026, 6, 15, 0, 5).toISOString(), "zh")).toBe("今天");
    expect(formatRelativeDays(new Date(2026, 6, 15, 23, 59).toISOString(), "en")).toBe("today");
  });

  it("one day back is yesterday, earlier by calendar-day difference as n days ago (across months)", () => {
    expect(formatRelativeDays(new Date(2026, 6, 14, 23, 0).toISOString(), "zh")).toBe("昨天");
    expect(formatRelativeDays(new Date(2026, 6, 14, 1, 0).toISOString(), "en")).toBe("yesterday");
    expect(formatRelativeDays(new Date(2026, 6, 10, 8, 0).toISOString(), "zh")).toBe("5 天前");
    expect(formatRelativeDays(new Date(2026, 5, 5, 8, 0).toISOString(), "en")).toBe("40 days ago");
  });

  it("future time (clock skew) falls back to the absolute time", () => {
    const future = new Date(2026, 6, 20, 8, 5).toISOString();
    expect(formatRelativeDays(future, "zh")).toBe(formatDateTime(future));
    expect(formatRelativeDays(future, "zh")).toBe("2026-07-20 08:05");
  });

  it("parse failure returns the input unchanged", () => {
    expect(formatRelativeDays("not-a-date", "zh")).toBe("not-a-date");
  });
});

describe("formatRelativeDate (semantic update time on Skill cards)", () => {
  // Fix "now" to local 2026-07-15 12:00 (same convention as formatRelativeDays).
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 15, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("same day is updated today, regardless of the hour", () => {
    expect(formatRelativeDate(new Date(2026, 6, 15, 0, 5).toISOString(), "zh")).toBe("今天更新");
    expect(formatRelativeDate(new Date(2026, 6, 15, 23, 59).toISOString(), "en")).toBe(
      "updated today",
    );
  });

  it("one day back is updated yesterday, earlier as updated n days ago by calendar-day difference (across months)", () => {
    expect(formatRelativeDate(new Date(2026, 6, 14, 23, 0).toISOString(), "zh")).toBe("昨天更新");
    expect(formatRelativeDate(new Date(2026, 6, 14, 1, 0).toISOString(), "en")).toBe(
      "updated yesterday",
    );
    expect(formatRelativeDate(new Date(2026, 6, 10, 8, 0).toISOString(), "zh")).toBe("5 天前更新");
    expect(formatRelativeDate(new Date(2026, 5, 5, 8, 0).toISOString(), "en")).toBe(
      "updated 40 days ago",
    );
  });

  it("future time (clock skew) falls back to the date itself (without the updated wording)", () => {
    expect(formatRelativeDate("2026-07-20", "zh")).toBe("2026-07-20");
  });

  it("parse failure returns the input unchanged", () => {
    expect(formatRelativeDate("not-a-date", "zh")).toBe("not-a-date");
    expect(formatRelativeDate("", "en")).toBe("");
  });
});
