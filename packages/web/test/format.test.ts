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
  it("小于 1000 原样输出", () => {
    expect(humanizeTokens(0)).toBe("0");
    expect(humanizeTokens(999)).toBe("999");
  });

  it("千位缩写并去掉多余的 .0", () => {
    expect(humanizeTokens(1000)).toBe("1k");
    expect(humanizeTokens(1234)).toBe("1.2k");
    expect(humanizeTokens(4000)).toBe("4k");
  });

  it("百万缩写", () => {
    expect(humanizeTokens(1_500_000)).toBe("1.5M");
    expect(humanizeTokens(2_000_000)).toBe("2M");
  });

  it("负数保留符号（上下文回落）", () => {
    expect(humanizeTokens(-1200)).toBe("-1.2k");
    expect(humanizeTokens(-500)).toBe("-500");
  });
});

describe("humanizeDuration", () => {
  it("毫秒/秒/分钟折算", () => {
    expect(humanizeDuration(820)).toBe("820ms");
    expect(humanizeDuration(2300)).toBe("2.3s");
    expect(humanizeDuration(5100)).toBe("5.1s");
    expect(humanizeDuration(63000)).toBe("1m3s");
    expect(humanizeDuration(130000)).toBe("2m10s");
  });
});

describe("signedDelta", () => {
  it("非负补 +，负数自带 -", () => {
    expect(signedDelta("1k")).toBe("+1k");
    expect(signedDelta("-1k")).toBe("-1k");
    expect(signedDelta("0")).toBe("+0");
  });
});

describe("formatMoney", () => {
  it("无 pricing 显示 —", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
  });

  it("缺省按美元、按量级取小数位", () => {
    expect(formatMoney(0)).toBe("$0");
    expect(formatMoney(0.1234)).toBe("$0.1234");
    expect(formatMoney(1.5)).toBe("$1.50");
    expect(formatMoney(150)).toBe("$150");
  });

  it("人民币按 1:7 折算", () => {
    expect(formatMoney(0, "CNY")).toBe("¥0");
    expect(formatMoney(1, "CNY")).toBe("¥7.00");
    expect(formatMoney(0.01, "CNY")).toBe("¥0.0700");
  });
});

describe("formatPercent", () => {
  it("四舍五入到整数百分比（缓存命中率）", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.714)).toBe("71%");
    expect(formatPercent(0.716)).toBe("72%");
    expect(formatPercent(1)).toBe("100%");
  });

  it("null / 非有限值（输入为 0，命中率无从谈起）显示 —", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(undefined)).toBe("—");
    expect(formatPercent(Number.NaN)).toBe("—");
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatBytes", () => {
  it("字节缩写", () => {
    expect(formatBytes(812)).toBe("812B");
    expect(formatBytes(3481)).toBe("3.4KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2MB");
  });
});

describe("computeTps", () => {
  it("输出 token ÷ LLM 秒数（已知量核对）", () => {
    expect(computeTps(900, 3000)).toBe(300); // 900 / 3s
    expect(computeTps(1500, 2000)).toBe(750); // 1500 / 2s
  });

  it("llmMs ≤ 0（无计时）返回 null，避免除零", () => {
    expect(computeTps(900, 0)).toBeNull();
    expect(computeTps(900, -5)).toBeNull();
  });
});

describe("formatTps", () => {
  it("小于 1000 保留一位小数（去掉多余的 .0）", () => {
    expect(formatTps(42.53)).toBe("42.5 tok/s");
    expect(formatTps(120)).toBe("120 tok/s");
    expect(formatTps(300)).toBe("300 tok/s");
    expect(formatTps(999.9)).toBe("999.9 tok/s");
  });

  it("不小于 1000 按 k / M 量级缩写（与 humanizeTokens 同口径）", () => {
    expect(formatTps(1000)).toBe("1k tok/s");
    expect(formatTps(37_783.4)).toBe("37.8k tok/s");
    expect(formatTps(1_200_000)).toBe("1.2M tok/s");
  });

  it("null / 非有限值显示 —", () => {
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

  it("同日「今天」，与当天几点无关", () => {
    expect(formatRelativeDays(new Date(2026, 6, 15, 0, 5).toISOString(), "zh")).toBe("今天");
    expect(formatRelativeDays(new Date(2026, 6, 15, 23, 59).toISOString(), "en")).toBe("today");
  });

  it("隔日「昨天」，更早按日历日差「n 天前」（含跨月）", () => {
    expect(formatRelativeDays(new Date(2026, 6, 14, 23, 0).toISOString(), "zh")).toBe("昨天");
    expect(formatRelativeDays(new Date(2026, 6, 14, 1, 0).toISOString(), "en")).toBe("yesterday");
    expect(formatRelativeDays(new Date(2026, 6, 10, 8, 0).toISOString(), "zh")).toBe("5 天前");
    expect(formatRelativeDays(new Date(2026, 5, 5, 8, 0).toISOString(), "en")).toBe("40 days ago");
  });

  it("未来时间（时钟偏差）回落到绝对时间", () => {
    const future = new Date(2026, 6, 20, 8, 5).toISOString();
    expect(formatRelativeDays(future, "zh")).toBe(formatDateTime(future));
    expect(formatRelativeDays(future, "zh")).toBe("2026-07-20 08:05");
  });

  it("解析失败原样返回", () => {
    expect(formatRelativeDays("not-a-date", "zh")).toBe("not-a-date");
  });
});

describe("formatRelativeDate（技能卡片的语义化更新时间）", () => {
  // Fix "now" to local 2026-07-15 12:00 (same convention as formatRelativeDays).
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 15, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("同日「今天更新 / updated today」，与当天几点无关", () => {
    expect(formatRelativeDate(new Date(2026, 6, 15, 0, 5).toISOString(), "zh")).toBe("今天更新");
    expect(formatRelativeDate(new Date(2026, 6, 15, 23, 59).toISOString(), "en")).toBe(
      "updated today",
    );
  });

  it("隔日「昨天更新」，更早按日历日差「n 天前更新」（含跨月）", () => {
    expect(formatRelativeDate(new Date(2026, 6, 14, 23, 0).toISOString(), "zh")).toBe("昨天更新");
    expect(formatRelativeDate(new Date(2026, 6, 14, 1, 0).toISOString(), "en")).toBe(
      "updated yesterday",
    );
    expect(formatRelativeDate(new Date(2026, 6, 10, 8, 0).toISOString(), "zh")).toBe("5 天前更新");
    expect(formatRelativeDate(new Date(2026, 5, 5, 8, 0).toISOString(), "en")).toBe(
      "updated 40 days ago",
    );
  });

  it("未来时间（时钟偏差）回落到日期本身（不加「更新」措辞）", () => {
    expect(formatRelativeDate("2026-07-20", "zh")).toBe("2026-07-20");
  });

  it("解析失败原样返回", () => {
    expect(formatRelativeDate("not-a-date", "zh")).toBe("not-a-date");
    expect(formatRelativeDate("", "en")).toBe("");
  });
});
