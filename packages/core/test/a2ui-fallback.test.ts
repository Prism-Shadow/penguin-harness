/**
 * The text fallback and the composer fill texts (a2ui/fallback.ts): each block type as readable
 * Markdown in both languages, mermaid and invalid blocks left untouched, and the exact strings a
 * pick fills — the model reads them as ordinary user text next turn. Widgets print for a pinned
 * moment and zone; the helpers they share with the renderers (a2ui/widgets.ts) get direct cases
 * only where the fallback does not already show them.
 */
import { describe, expect, it } from "vitest";
import {
  choiceFillText,
  countdownParts,
  formFillText,
  resolveMetric,
  toFallbackMarkdown,
  type A2uiChoice,
  type A2uiForm,
  type A2uiMetric,
  type A2uiMetrics,
  type A2uiWeather,
} from "../src/a2ui/index.js";

const fence = (spec: unknown) => `\`\`\`a2ui\n${JSON.stringify(spec)}\n\`\`\``;

const choice: A2uiChoice = {
  type: "choice",
  question: "Which?",
  options: [
    { label: "A", value: "Use A", description: "first", recommended: true },
    { label: "B" },
  ],
};

describe("toFallbackMarkdown", () => {
  it("a choice becomes the bold question, a numbered list and the reply hint, in the reply's language", () => {
    expect(toFallbackMarkdown(`Pick one.\n\n${fence(choice)}\n`)).toBe(
      "Pick one.\n\n**Which?**\n\n1. A — first (recommended)\n2. B\n\nReply with a number or your own answer.\n",
    );
    expect(toFallbackMarkdown(fence(choice), { lang: "zh" })).toBe(
      "**Which?**\n\n1. A — first（推荐）\n2. B\n\n回复编号或直接写出你的答案。",
    );
  });

  it("a form becomes one bullet per field with its options, range and unit inline", () => {
    const form: A2uiForm = {
      type: "form",
      title: "Size",
      fields: [
        { id: "size", label: "Size", kind: "number", min: 1, max: 10, unit: "GB", required: true },
        { id: "kind", label: "Kind", kind: "single", options: [{ label: "A" }, { label: "B" }] },
      ],
    };
    expect(toFallbackMarkdown(fence(form), { lang: "en" })).toBe(
      "**Size**\n\n- **Size** (required): 1–10 GB\n- **Kind**: A / B\n\nReply with one line per field.",
    );
  });

  it("steps become a numbered list with the warning above the step, the note below, and the code as a fence", () => {
    const steps = {
      type: "steps",
      steps: [
        { warning: "Back up.", text: "Delete it.", code: "rm x", lang: "sh" },
        { text: "Start again.", note: "Takes a minute." },
      ],
    };
    expect(toFallbackMarkdown(fence(steps), { lang: "en" })).toBe(
      [
        "1. **WARNING:** Back up.",
        "",
        "   Delete it.",
        "",
        "   ```sh",
        "   rm x",
        "   ```",
        "2. Start again.",
        "",
        "   **NOTE:** Takes a minute.",
      ].join("\n"),
    );
  });

  it("a callout becomes a blockquote with a bold tone label, title included", () => {
    expect(
      toFallbackMarkdown(fence({ type: "callout", tone: "warning", text: "Careful." }), {
        lang: "en",
      }),
    ).toBe("> **Warning:** Careful.");
    expect(
      toFallbackMarkdown(fence({ type: "callout", tone: "note", title: "提示", text: "内容" }), {
        lang: "zh",
      }),
    ).toBe("> **说明：提示**\n>\n> 内容");
  });

  it("leaves mermaid fences, invalid blocks and unclosed fences as they are", () => {
    const mermaid = "Flow:\n\n```mermaid\nflowchart LR\n  A --> B\n```\n";
    expect(toFallbackMarkdown(mermaid)).toBe(mermaid);
    const invalid = 'Note:\n\n```a2ui\n{"type":"nope"}\n```\n';
    expect(toFallbackMarkdown(invalid)).toBe(invalid);
    const unclosed = `Pick one.\n\n\`\`\`a2ui\n${JSON.stringify(choice)}`;
    expect(toFallbackMarkdown(unclosed)).toBe(unclosed);
  });
});

describe("toFallbackMarkdown: widgets", () => {
  // Sunday 2026-10-04, 06:05 UTC.
  const at = { now: new Date("2026-10-04T06:05:00Z"), timeZone: "UTC" };

  it("weather: the headline, the details, the next hours and days, and when and where from", () => {
    const weather: A2uiWeather = {
      type: "weather",
      place: "Beijing",
      condition: "partly-cloudy",
      temp: 18,
      high: 22,
      low: 12,
      feelsLike: 17,
      humidity: 62,
      windSpeed: 12,
      windDirection: "NE",
      hourly: [
        { time: "2026-10-04T07:00Z", temp: 18 },
        { time: "08:00", temp: 19 },
      ],
      daily: [
        { date: "2026-10-04", high: 22, low: 12, condition: "partly-cloudy", precip: 20 },
        { date: "2026-10-05", high: 19, low: 11, condition: "rain", precip: 80 },
      ],
      asOf: "2026-10-04T06:05:00Z",
      source: "Open-Meteo",
    };
    expect(toFallbackMarkdown(fence(weather), { lang: "en", ...at })).toBe(
      [
        "**Beijing · Partly cloudy 18°C**",
        "",
        "H 22° / L 12° · Feels like 17° · Humidity 62% · Wind 12 km/h NE",
        "",
        "Next hours: 07:00 18° · 08:00 19°",
        "",
        "Next days:",
        "- Today Partly cloudy 22° / 12° · 20%",
        "- Mon Rain 19° / 11° · 80%",
        "",
        "As of 06:05 · Source: Open-Meteo",
      ].join("\n"),
    );
    expect(toFallbackMarkdown(fence(weather), { lang: "zh", ...at })).toBe(
      [
        "**Beijing · 多云 18°C**",
        "",
        "最高 22° / 最低 12° · 体感 17° · 湿度 62% · 风 12 km/h NE",
        "",
        "逐小时：07:00 18° · 08:00 19°",
        "",
        "未来几天：",
        "- 今天 多云 22° / 12° · 降水 20%",
        "- 周一 雨 19° / 11° · 降水 80%",
        "",
        "数据时间 06:05 · 来源：Open-Meteo",
      ].join("\n"),
    );
  });

  it("clock: one line per zone with its time, weekday and zone name", () => {
    const clock = {
      type: "clock",
      title: "Team",
      hourCycle: "24",
      zones: [
        { zone: "local" },
        { zone: "Asia/Shanghai", label: "Beijing" },
        { zone: "America/New_York" },
      ],
    };
    expect(toFallbackMarkdown(fence(clock), { lang: "en", ...at })).toBe(
      [
        "**Team**",
        "",
        "- Local time: 06:05 (Sun, UTC)",
        "- Beijing: 14:05 (Sun, Asia/Shanghai)",
        "- New York: 02:05 (Sun, America/New_York)",
      ].join("\n"),
    );
  });

  it("countdown: the two largest units left and the target, or reached", () => {
    const countdown = { type: "countdown", to: "2026-10-07T10:17:00Z", label: "Launch deadline" };
    expect(toFallbackMarkdown(fence(countdown), { lang: "en", ...at })).toBe(
      "**Launch deadline**: 3 days 4 hours left (2026-10-07 10:17)",
    );
    const reached = { ...countdown, to: "2026-10-04T06:00:00Z" };
    expect(toFallbackMarkdown(fence(reached), { lang: "en", ...at })).toBe(
      "**Launch deadline**: reached (2026-10-04 06:00)",
    );
  });

  it("metrics: one line per reading with its detail, change and tone, then when it was read", () => {
    const metrics: A2uiMetrics = {
      type: "metrics",
      title: "This machine",
      items: [
        {
          label: "Memory",
          value: 13.9,
          max: 16,
          kind: "used",
          unit: "GB",
          decimals: 1,
          warn: 13,
          danger: 15,
          delta: 0.4,
          deltaLabel: "vs. yesterday",
        },
        { label: "Disk", value: 37, max: 100, kind: "used", unit: "%" },
        { label: "Quota", value: 1240, max: 5000, kind: "remaining", detail: "resets in 3 days" },
        {
          label: "Budget",
          value: 200,
          max: 1000,
          kind: "remaining",
          prefix: "¥",
          warn: 300,
          danger: 100,
          delta: -60,
        },
        { label: "Upload", value: 12, max: 12, kind: "progress", unit: "tasks" },
      ],
      asOf: "2026-10-03T22:00:00Z",
    };
    expect(toFallbackMarkdown(fence(metrics), { lang: "en", ...at })).toBe(
      [
        "**This machine**",
        "",
        "- Memory: 13.9 GB — 13.9 / 16 GB used (+0.4 GB vs. yesterday) — warning",
        "- Disk: 37% — 37% used",
        "- Quota: 1,240 — resets in 3 days",
        "- Budget: ¥200 — ¥200 / ¥1,000 left (\u2212¥60) — warning",
        "- Upload: 12 tasks — 12 / 12 tasks — done",
        "",
        "As of 10-03 22:00",
      ].join("\n"),
    );
    expect(toFallbackMarkdown(fence(metrics), { lang: "zh", ...at })).toBe(
      [
        "**This machine**",
        "",
        "- Memory：13.9 GB — 已用 13.9 / 16 GB（+0.4 GB vs. yesterday） — 注意",
        "- Disk：37% — 已用 37%",
        "- Quota：1,240 — resets in 3 days",
        "- Budget：¥200 — 剩余 ¥200 / ¥1,000（\u2212¥60） — 注意",
        "- Upload：12 tasks — 12 / 12 tasks — 已完成",
        "",
        "数据时间 10-03 22:00",
      ].join("\n"),
    );
  });
});

describe("widget helpers", () => {
  it("resolveMetric: the tone along `worse`, done for a complete progress, and the defaults", () => {
    const tone = (metric: Partial<A2uiMetric>) =>
      resolveMetric({ label: "x", value: 0, ...metric }).tone;
    // A reading: higher is worse, so the marks hold at or above.
    expect(tone({ value: 95, warn: 80, danger: 95 })).toBe("danger");
    expect(tone({ value: 80, warn: 80, danger: 95 })).toBe("attention");
    expect(tone({ value: 79, warn: 80, danger: 95 })).toBeUndefined();
    // A remaining share: lower is worse, so the marks hold at or below.
    const quota = { kind: "remaining", max: 5000, warn: 1000, danger: 250 } as const;
    expect(tone({ ...quota, value: 250 })).toBe("danger");
    expect(tone({ ...quota, value: 1000 })).toBe("attention");
    expect(tone({ ...quota, value: 1001 })).toBeUndefined();
    expect(tone({ kind: "progress", max: 12, value: 12 })).toBe("done");
    expect(resolveMetric({ label: "x", value: 3, max: 12, kind: "progress" })).toEqual({
      kind: "progress",
      gauge: "bar",
      worse: "high",
      share: 0.25,
    });
  });

  it("countdownParts counts a part of a second as a whole one and is reached at the target", () => {
    const target = new Date("2026-10-07T10:17:00Z");
    expect(countdownParts(target, new Date("2026-10-07T10:16:59.500Z"))).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 1,
      reached: false,
    });
    expect(countdownParts(target, target)).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      reached: true,
    });
  });
});

describe("fill texts", () => {
  it("a choice fills the picked options' values (default: label), joined with the language's separator", () => {
    expect(choiceFillText(choice, ["A"], "en")).toBe("Use A");
    expect(choiceFillText(choice, ["A", "B"], "en")).toBe("Use A, B");
    expect(choiceFillText(choice, ["A", "B"], "zh")).toBe("Use A、B");
    expect(choiceFillText(choice, ["something else"], "en")).toBe("something else");
  });

  it("a form fills one `label: answer` line per answered field, numbers with their unit, lists joined", () => {
    const form: A2uiForm = {
      type: "form",
      fields: [
        { id: "n", label: "Count", kind: "number", unit: "GB" },
        {
          id: "k",
          label: "Kind",
          kind: "multiple",
          options: [{ label: "A", value: "alpha" }, { label: "B" }],
        },
        { id: "t", label: "Notes", kind: "text" },
      ],
    };
    const answers = { n: "3", k: ["A", "B"], t: "" };
    expect(formFillText(form, answers, "en")).toBe("Count: 3 GB\nKind: alpha, B");
    expect(formFillText(form, answers, "zh")).toBe("Count：3 GB\nKind：alpha、B");
    expect(formFillText(form, {}, "en")).toBe("");
  });
});
