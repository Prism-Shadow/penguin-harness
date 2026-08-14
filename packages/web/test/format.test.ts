/**
 * format.ts unit tests: Token/duration humanized abbreviations match the CLI convention.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cacheHitRate,
  computeTps,
  formatBytes,
  formatDateTime,
  formatMoney,
  formatMonthDay,
  formatPercent,
  formatRelativeDate,
  formatRelativeDays,
  formatRelativeShort,
  formatScore,
  formatTps,
  humanizeDuration,
  humanizeTokens,
  signedDelta,
} from "../src/lib/format";

describe("formatScore", () => {
  it("keeps up to the stored two decimal places", () => {
    expect(formatScore(72)).toBe("72");
    expect(formatScore(72.5)).toBe("72.5");
    expect(formatScore(72.35)).toBe("72.35");
  });
});

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

  it("compact (narrow screens) drops the tenths from 10s up, keeps them below", () => {
    expect(humanizeDuration(12700, { compact: true })).toBe("13s");
    expect(humanizeDuration(59400, { compact: true })).toBe("59s");
    expect(humanizeDuration(1700, { compact: true })).toBe("1.7s");
    expect(humanizeDuration(820, { compact: true })).toBe("820ms");
    expect(humanizeDuration(63000, { compact: true })).toBe("1m3s");
  });

  it("a seconds remainder that rounds to 60 carries into the minute", () => {
    // Rounding the remainder against floored minutes would read 1m60s / 59m60s.
    expect(humanizeDuration(119_500)).toBe("2m0s");
    expect(humanizeDuration(119_700)).toBe("2m0s");
    expect(humanizeDuration(179_600)).toBe("3m0s");
    expect(humanizeDuration(3_599_700)).toBe("60m0s");
    // Below the carry the remainder still rounds normally.
    expect(humanizeDuration(119_400)).toBe("1m59s");
  });

  it("compact promotes a sub-minute value that rounds to 60s into the minute form", () => {
    expect(humanizeDuration(59_600, { compact: true })).toBe("1m0s");
    // Without compact the tenths are kept, so there is nothing to carry.
    expect(humanizeDuration(59_600)).toBe("59.6s");
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

  it("compact (narrow screens): sub-unit costs keep 2 significant digits, never rounding a nonzero cost to zero", () => {
    expect(formatMoney(0.1234, "USD", { compact: true })).toBe("$0.12");
    expect(formatMoney(0.0012, "USD", { compact: true })).toBe("$0.0012");
    expect(formatMoney(0.00047, "USD", { compact: true })).toBe("$0.00047");
    expect(formatMoney(1.5, "USD", { compact: true })).toBe("$1.50");
    expect(formatMoney(150, "USD", { compact: true })).toBe("$150");
    expect(formatMoney(0, "USD", { compact: true })).toBe("$0");
    expect(formatMoney(0.01, "CNY", { compact: true })).toBe("¥0.07");
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

describe("cacheHitRate (shared by the Trace summaries and the Cost center's cacheRead bubble)", () => {
  it("cacheRead ÷ (cacheRead + cacheWrite)", () => {
    expect(cacheHitRate(50, 50)).toBe(0.5);
    expect(cacheHitRate(75, 25)).toBe(0.75);
    expect(cacheHitRate(100, 0)).toBe(1);
    expect(cacheHitRate(0, 100)).toBe(0); // all writes, no hits: 0 is a real value, not the guard
  });

  it("renders via formatPercent as a whole percent", () => {
    expect(formatPercent(cacheHitRate(1, 2))).toBe("33%"); // 33.3… rounds down
    expect(formatPercent(cacheHitRate(2, 1))).toBe("67%"); // 66.6… rounds up
    expect(formatPercent(cacheHitRate(999, 1))).toBe("100%"); // 99.9 rounds to 100% at whole-percent precision
  });

  it("denominator 0 (no cache activity) yields null: the bubble omits the line, formatPercent shows —", () => {
    expect(cacheHitRate(0, 0)).toBeNull();
    expect(formatPercent(cacheHitRate(0, 0))).toBe("—");
  });
});

describe("formatBytes", () => {
  it("byte abbreviation", () => {
    expect(formatBytes(812)).toBe("812B");
    expect(formatBytes(3481)).toBe("3.4KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2MB");
  });

  it("a value that rounds up to 1024 carries into the next unit", () => {
    // Picking the unit from the raw value would print 1024KB / 1024MB.
    expect(formatBytes(1024 * 1024 - 6)).toBe("1MB");
    expect(formatBytes(1024 * 1024 * 1024 - 800)).toBe("1GB");
    // Just below the carry the unit is unchanged.
    expect(formatBytes(1024 * 1024 - 60)).toBe("1023.9KB");
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

describe("formatRelativeShort", () => {
  // Fix "now" (the sidebar row's compact last-active time is measured from it).
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 15, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const at = (mo: number, d: number, h: number, mi: number) =>
    new Date(2026, mo, d, h, mi).toISOString();

  it("under a minute reads as just-now", () => {
    expect(formatRelativeShort(new Date(2026, 6, 15, 11, 59, 30).toISOString(), "zh")).toBe("刚刚");
    expect(formatRelativeShort(at(6, 15, 12, 0), "en")).toBe("now");
  });

  it("minute / hour / day steps, floored: zh dictionary wording, en ultra-short", () => {
    expect(formatRelativeShort(at(6, 15, 11, 55), "zh")).toBe("5 分钟前");
    expect(formatRelativeShort(at(6, 15, 11, 1), "en")).toBe("59m");
    expect(formatRelativeShort(at(6, 15, 9, 30), "zh")).toBe("2 小时前");
    expect(formatRelativeShort(at(6, 14, 12, 30), "en")).toBe("23h");
    expect(formatRelativeShort(at(6, 14, 11, 0), "zh")).toBe("1 天前");
    expect(formatRelativeShort(at(6, 9, 12, 0), "en")).toBe("6d");
  });

  it("a week or older — and future times (clock skew) — fall back to the absolute month-day", () => {
    expect(formatRelativeShort("2026-07-01T00:00:00.000Z", "zh")).toBe("7 月 1 日");
    expect(formatRelativeShort("2026-01-02T00:00:00.000Z", "en")).toBe("Jan 2");
    expect(formatRelativeShort("2026-07-20T00:00:00.000Z", "en")).toBe("Jul 20");
  });

  it("unparsable input yields the empty string (the row hides the slot instead of showing garbage)", () => {
    expect(formatRelativeShort("not-a-date", "zh")).toBe("");
    expect(formatRelativeShort("", "en")).toBe("");
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

describe("formatMonthDay (version-line 'last updated' date)", () => {
  it("formats a date-only string per locale, matching the owner-specified wording", () => {
    expect(formatMonthDay("2026-07-26", "en")).toBe("Jul 26");
    expect(formatMonthDay("2026-07-26", "zh")).toBe("7 月 26 日");
    expect(formatMonthDay("2026-01-05", "en")).toBe("Jan 5");
    expect(formatMonthDay("2026-12-31", "zh")).toBe("12 月 31 日");
  });

  it("reads only the date part of a full ISO timestamp — no timezone round-trip that could shift a day", () => {
    expect(formatMonthDay("2026-07-01T00:00:00Z", "en")).toBe("Jul 1");
    expect(formatMonthDay("2026-05-05T12:00:00Z", "zh")).toBe("5 月 5 日");
  });

  it("returns unparsable or out-of-range input unchanged", () => {
    expect(formatMonthDay("not-a-date", "en")).toBe("not-a-date");
    expect(formatMonthDay("2026-7-26", "zh")).toBe("2026-7-26"); // not the zero-padded wire format
    expect(formatMonthDay("2026-07-26x", "en")).toBe("2026-07-26x");
    expect(formatMonthDay("2026-13-01", "en")).toBe("2026-13-01");
    expect(formatMonthDay("2026-00-10", "zh")).toBe("2026-00-10");
  });
});
