/**
 * The text fallback and the composer fill texts (a2ui/fallback.ts): each block type as readable
 * Markdown in both languages, mermaid and invalid blocks left untouched, and the exact strings a
 * pick fills — the model reads them as ordinary user text next turn. A form's bullet says what
 * each kind takes (options, range, format, yes / no), its default and its hint; its fill text
 * writes each kind's answer (a switch as Yes / No, several lines indented, a datetime with a
 * space), and a form left at its initial answers fills its defaults. Widgets print for a pinned
 * moment and zone; the helpers they share with the renderers (a2ui/widgets.ts) get direct cases
 * only where the fallback does not already show them.
 */
import { describe, expect, it } from "vitest";
import {
  choiceFillText,
  countdownParts,
  formFillText,
  initialAnswer,
  resolveMetric,
  toFallbackMarkdown,
  type A2uiChoice,
  type A2uiForm,
  type A2uiFormAnswer,
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

  it("a form becomes one bullet per field: what its kind takes, its default and its hint", () => {
    // A unit is spaced as every A2UI value is: "1–10 GB", but a percent hugs its range.
    const measured: A2uiForm = {
      type: "form",
      title: "Size",
      fields: [
        {
          id: "size",
          label: "Size",
          kind: "number",
          min: 1,
          max: 10,
          unit: "GB",
          required: true,
          default: 3,
        },
        { id: "temp", label: "Temperature", kind: "slider", min: 0, max: 1, step: 0.1 },
        { id: "cpu", label: "CPU target", kind: "slider", min: 50, max: 90, step: 5, unit: "%" },
        { id: "kind", label: "Kind", kind: "single", options: [{ label: "A" }, { label: "B" }] },
        {
          id: "notes",
          label: "Notes",
          kind: "textarea",
          placeholder: "Anything else",
          hint: "one per line",
        },
      ],
    };
    const picked: A2uiForm = {
      type: "form",
      fields: [
        { id: "cdn", label: "CDN", kind: "switch", default: true },
        { id: "run", label: "First run", kind: "datetime", default: "2026-10-20T09:30" },
        {
          id: "regions",
          label: "Regions",
          kind: "multiple",
          options: [{ label: "EU" }, { label: "US" }, { label: "Asia" }],
          default: ["US", "EU"],
        },
        {
          id: "lang",
          label: "Language",
          kind: "select",
          placeholder: "Pick one",
          options: [{ label: "Go" }, { label: "Rust" }],
        },
      ],
    };
    const dated: A2uiForm = {
      type: "form",
      fields: [
        { id: "day", label: "Day", kind: "date" },
        { id: "at", label: "At", kind: "time", required: true },
        { id: "name", label: "Name", kind: "text", hint: "lower-case" },
      ],
    };
    expect(toFallbackMarkdown(fence(measured), { lang: "en" })).toBe(
      [
        "**Size**",
        "",
        "- **Size** (required): 1–10 GB (default 3)",
        "- **Temperature**: 0–1 step 0.1",
        "- **CPU target**: 50–90% step 5",
        "- **Kind**: A / B",
        "- **Notes**: Anything else — one per line",
        "",
        "Reply with one line per field.",
      ].join("\n"),
    );
    expect(toFallbackMarkdown(fence(picked), { lang: "en" })).toBe(
      [
        "- **CDN**: yes / no (default yes)",
        "- **First run**: YYYY-MM-DD HH:mm (default 2026-10-20 09:30)",
        "- **Regions**: EU / US / Asia (default EU, US)",
        "- **Language**: Go / Rust",
        "",
        "Reply with one line per field.",
      ].join("\n"),
    );
    expect(toFallbackMarkdown(fence(dated), { lang: "en" })).toBe(
      [
        "- **Day**: YYYY-MM-DD",
        "- **At** (required): HH:mm",
        "- **Name** — lower-case",
        "",
        "Reply with one line per field.",
      ].join("\n"),
    );
    expect(toFallbackMarkdown(fence(measured), { lang: "zh" })).toBe(
      [
        "**Size**",
        "",
        "- **Size**（必填）：1–10 GB（默认 3）",
        "- **Temperature**：0–1 步长 0.1",
        "- **CPU target**：50–90% 步长 5",
        "- **Kind**：A / B",
        "- **Notes**：Anything else — one per line",
        "",
        "按字段逐行回复。",
      ].join("\n"),
    );
    expect(toFallbackMarkdown(fence(picked), { lang: "zh" })).toBe(
      [
        "- **CDN**：是 / 否（默认 是）",
        "- **First run**：YYYY-MM-DD HH:mm（默认 2026-10-20 09:30）",
        "- **Regions**：EU / US / Asia（默认 EU、US）",
        "- **Language**：Go / Rust",
        "",
        "按字段逐行回复。",
      ].join("\n"),
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

  it("a form fills one `label: answer` line per answered field, each kind its own way", () => {
    const form: A2uiForm = {
      type: "form",
      fields: [
        { id: "n", label: "Pods", kind: "number", unit: "pods" },
        { id: "v", label: "Volume", kind: "slider", min: 0, max: 1, step: 0.1, unit: "dB" },
        { id: "cpu", label: "CPU target", kind: "slider", min: 50, max: 90, step: 5, unit: "%" },
        {
          id: "k",
          label: "Kind",
          kind: "multiple",
          options: [{ label: "A", value: "alpha" }, { label: "B" }],
        },
        {
          id: "s",
          label: "Region",
          kind: "select",
          options: [{ label: "EU", value: "eu-west-1" }, { label: "US" }],
        },
        { id: "c", label: "CDN", kind: "switch" },
        { id: "notes", label: "Notes", kind: "textarea" },
      ],
    };
    const answers = {
      n: "3",
      v: "0.7",
      cpu: "70",
      k: ["A", "B"],
      s: "EU",
      c: false,
      notes: "first\n\nsecond  \n",
    };
    expect(formFillText(form, answers, "en")).toBe(
      "Pods: 3 pods\nVolume: 0.7 dB\nCPU target: 70%\nKind: alpha, B\nRegion: eu-west-1\nCDN: No\nNotes:\n  first\n\n  second",
    );
    expect(formFillText(form, answers, "zh")).toBe(
      "Pods：3 pods\nVolume：0.7 dB\nCPU target：70%\nKind：alpha、B\nRegion：eu-west-1\nCDN：否\nNotes：\n  first\n\n  second",
    );
    expect(formFillText(form, {}, "en")).toBe("");
  });

  it("dates and times fill as written, a datetime with a space; blank text and an empty select fill nothing", () => {
    const form: A2uiForm = {
      type: "form",
      fields: [
        { id: "d", label: "Day", kind: "date" },
        { id: "t", label: "At", kind: "time" },
        { id: "r", label: "Run", kind: "datetime" },
        { id: "x", label: "Name", kind: "text" },
        { id: "s", label: "Region", kind: "select", options: [{ label: "EU" }, { label: "US" }] },
        { id: "o", label: "Note", kind: "textarea" },
      ],
    };
    const answers = {
      d: "2026-10-20",
      t: "09:30",
      r: "2026-10-20T09:30",
      x: "  ",
      s: "",
      o: "one line",
    };
    expect(formFillText(form, answers, "en")).toBe(
      "Day: 2026-10-20\nAt: 09:30\nRun: 2026-10-20 09:30\nNote: one line",
    );
  });

  it("an answer of the wrong shape for its kind fills nothing", () => {
    const form: A2uiForm = {
      type: "form",
      fields: [
        { id: "on", label: "CDN", kind: "switch" },
        { id: "name", label: "Name", kind: "text" },
      ],
    };
    expect(formFillText(form, { on: "yes", name: true }, "en")).toBe("");
  });

  it("a form left at its initial answers fills its defaults, a switch and a slider included", () => {
    const form: A2uiForm = {
      type: "form",
      fields: [
        { id: "pods", label: "Pods", kind: "number", min: 1, max: 10, default: 3 },
        { id: "share", label: "Share", kind: "slider", min: 10, max: 90 },
        { id: "cdn", label: "CDN", kind: "switch", default: true },
        { id: "logs", label: "Logs", kind: "switch" },
        {
          id: "regions",
          label: "Regions",
          kind: "multiple",
          options: [{ label: "EU" }, { label: "US", value: "us-east-1" }],
          default: ["US", "EU"],
        },
        { id: "notes", label: "Notes", kind: "text" },
      ],
    };
    const initial: Record<string, A2uiFormAnswer> = {};
    for (const field of form.fields) {
      const answer = initialAnswer(field);
      if (answer !== undefined) initial[field.id] = answer;
    }
    expect(formFillText(form, initial, "zh")).toBe(
      "Pods：3\nShare：10\nCDN：是\nLogs：否\nRegions：EU、us-east-1",
    );
  });
});
