/**
 * The date and time fields at rest (src/components/forms/date-time): what each shows and says
 * before it is opened. Static markup; the open panels are date-picker.dom.test.ts's.
 *
 * - Given a date, a time, a moment and a span, each field shows it the way the reader's locale
 *   writes it — 2026年11月12日 / Nov 12, 2026, 14:30 / 2:30 PM — and the time follows the
 *   locale's clock unless the field names one.
 * - Given nothing picked, the field shows the picker's placeholder, or the caller's.
 * - Given an optional field holding a value, the clear cross stands in for the calendar mark; an
 *   empty, a required or a closed field shows the mark and no cross.
 * - Given a title, the trigger is named by the title and what it shows and says it opens a
 *   dialog; a required field says so, and a refused one carries the error under it.
 * - Given a name, the value is posted under it, as a native input's would be.
 */
import { createElement } from "react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { DateField } from "../src/components/forms/date-time/date-field";
import { DateRangeField } from "../src/components/forms/date-time/date-range-field";
import { DateTimeField } from "../src/components/forms/date-time/date-time-field";
import { TimeField } from "../src/components/forms/date-time/time-field";
import { DEFAULT_UI_STRINGS, UiStringsProvider } from "../src/strings";
import type { UiStrings } from "../src/strings";
import { renderStatic } from "../src/testing";

const ZH: UiStrings = {
  ...DEFAULT_UI_STRINGS,
  dates: {
    ...DEFAULT_UI_STRINGS.dates,
    locale: "zh-CN",
    pickDate: "选择日期",
    clear: "清除",
    fieldName: (label, shown) => `${label}：${shown}`,
  },
};

const noop = () => {};

/** Markup with the locale's narrow and thin spaces read as plain ones. */
const draw = (element: ReactElement, strings?: UiStrings) =>
  renderStatic(
    strings === undefined ? element : createElement(UiStringsProvider, { strings }, element),
  ).replace(/[   ]/g, " ");

/** The trigger's opening tag: the one button that opens a dialog. */
const trigger = (html: string) => /<button[^>]*aria-haspopup="dialog"[^>]*>/.exec(html)?.[0] ?? "";

describe("what a field shows", () => {
  it("writes each value the way the reader's locale does", () => {
    const date = createElement(DateField, { value: "2026-11-12", onChange: noop });
    expect(draw(date)).toContain(">Nov 12, 2026<");
    expect(draw(date, ZH)).toContain(">2026年11月12日<");

    const time = createElement(TimeField, { value: "14:30", onChange: noop });
    expect(draw(time)).toContain(">2:30 PM<");
    expect(draw(time, ZH)).toContain(">14:30<");

    const moment = createElement(DateTimeField, { value: "2026-11-12T14:30", onChange: noop });
    expect(draw(moment)).toContain(">Nov 12, 2026, 2:30 PM<");
    expect(draw(moment, ZH)).toContain(">2026年11月12日 14:30<");

    const span = createElement(DateRangeField, {
      from: "2026-11-01",
      to: "2026-11-12",
      onChange: noop,
    });
    expect(draw(span)).toContain(">Nov 1 – 12, 2026<");
    expect(draw(span, ZH)).toContain(">2026年11月1日至12日<");
  });

  it("writes a span as the locale shares its two ends: the year and the month only once", () => {
    const span = (from: string, to: string) =>
      createElement(DateRangeField, { from, to, onChange: noop });
    expect(draw(span("2026-10-28", "2026-11-03"), ZH)).toContain(">2026年10月28日至11月3日<");
    expect(draw(span("2026-12-28", "2027-01-03"), ZH)).toContain(">2026年12月28日至2027年1月3日<");
    expect(draw(span("2026-11-12", "2026-11-12"), ZH)).toContain(">2026年11月12日<");
    expect(draw(span("2026-10-28", "2026-11-03"))).toContain(">Oct 28 – Nov 3, 2026<");
    // A span written end first still reads from its start.
    expect(draw(span("2026-11-12", "2026-11-01"))).toContain(">Nov 1 – 12, 2026<");
  });

  it("follows the clock a time field names over the locale's", () => {
    expect(
      draw(createElement(TimeField, { value: "14:30", onChange: noop, hourCycle: "h23" })),
    ).toContain(">14:30<");
    expect(
      draw(createElement(TimeField, { value: "07:05", onChange: noop, hourCycle: "h12" }), ZH),
    ).toContain(">上午7:05<");
  });

  it("shows the placeholder while nothing is picked, the caller's when it names one", () => {
    expect(draw(createElement(DateField, { value: "", onChange: noop }), ZH)).toContain(
      ">选择日期<",
    );
    expect(
      draw(createElement(DateTimeField, { value: "", onChange: noop, placeholder: "Never" })),
    ).toContain(">Never<");
    // A value the field cannot read is no value.
    expect(draw(createElement(DateField, { value: "2026-02-30", onChange: noop }))).toContain(
      `>${DEFAULT_UI_STRINGS.dates.pickDate}<`,
    );
  });
});

describe("the clear cross", () => {
  const cross = `aria-label="${DEFAULT_UI_STRINGS.dates.clear}"`;

  it("stands in for the mark on an optional field holding a value", () => {
    const html = draw(createElement(DateField, { value: "2026-11-12", onChange: noop }));
    expect(html).toContain(cross);
    expect(trigger(html)).not.toBe("");
    expect(html.slice(html.indexOf(trigger(html))).split("</button>")[0]).not.toContain("<svg");
  });

  it.each([
    ["empty", { value: "" }],
    ["required", { value: "2026-11-12", required: true }],
    ["closed", { value: "2026-11-12", disabled: true }],
    ["kept by the caller", { value: "2026-11-12", clearable: false }],
  ])("is absent from a field that is %s, which shows the mark", (_, props) => {
    const html = draw(createElement(DateField, { onChange: noop, ...props }));
    expect(html).not.toContain(cross);
    expect(html.slice(html.indexOf(trigger(html))).split("</button>")[0]).toContain("<svg");
  });
});

describe("what the trigger says", () => {
  it("is named by its title and what it shows, and opens a dialog", () => {
    const html = draw(
      createElement(DateTimeField, {
        label: "Start at",
        value: "2026-11-12T09:00",
        onChange: noop,
      }),
    );
    expect(trigger(html)).toContain('aria-label="Start at: Nov 12, 2026, 9:00 AM"');
    expect(trigger(html)).toContain('aria-expanded="false"');
    const unlabelled = draw(
      createElement(DateField, { "aria-label": "Due", value: "", onChange: noop }),
      ZH,
    );
    expect(trigger(unlabelled)).toContain('aria-label="Due：选择日期"');
  });

  it("says it is required, and carries a refusal under it", () => {
    const html = draw(
      createElement(DateField, {
        label: "Due",
        required: true,
        error: "Pick a day after today.",
        value: "2026-01-01",
        onChange: noop,
      }),
    );
    expect(trigger(html)).toContain('aria-required="true"');
    expect(trigger(html)).toContain('aria-invalid="true"');
    const described = /aria-describedby="([^"]+)"/.exec(trigger(html))?.[1];
    expect(html).toMatch(new RegExp(`id="${described}"[^>]*>Pick a day after today.<`));
  });

  it("posts the value under its name, as a native input does", () => {
    const html = draw(
      createElement(DateTimeField, { name: "startAt", value: "2026-11-12T09:00", onChange: noop }),
    );
    expect(html).toContain('<input type="hidden" name="startAt" value="2026-11-12T09:00"/>');
    expect(draw(createElement(DateField, { value: "2026-11-12", onChange: noop }))).not.toContain(
      'type="hidden"',
    );
  });
});
