// @vitest-environment jsdom
/**
 * The date and time pickers open, on a real page (test/helpers/dom.ts): the clock stands at
 * Thursday 12 November 2026, 14:37 on the reader's calendar.
 *
 * Date
 * - Given an empty field, opening focuses today; a press on a day writes it, closes the panel and
 *   hands the focus back to the field.
 * - Given bounds, a day outside them takes no press and the month steps past them are closed;
 *   Today is closed when today is outside, and the focus opens on the nearest day inside.
 * - Given the keyboard, the arrows carry the focus across the month's edge and the month with it,
 *   Page Up goes back a month, End goes to the week's last day, Enter writes the focused day.
 * - Given the title pressed, a month and a year typed on its wheels bring that month back to the
 *   grid.
 * - Given Escape, the panel closes and a dialog around the field stays open; a press outside
 *   closes it too.
 * - Given the clear cross, the field is emptied.
 * - Given a reader west of Greenwich late in the evening, today and Today are the reader's date.
 *
 * Range
 * - Given two presses in either order, the earlier day is the start; nothing is written until the
 *   second, and a panel closed between them writes nothing.
 * - Given a preset pressed, its span is written with its id, and the preset shows pressed after.
 *
 * Time
 * - Given a 12-hour locale, the hour wheel takes the focus, ↑ steps it, typed digits jump to an
 *   hour, and the day-period wheel turns the clock to the afternoon.
 * - Given a 24-hour locale, there is no day-period wheel and the hours run 00–23.
 * - Given a minute step, the minute wheel stops at its last step.
 * - Given a scroll, the wheel writes the row in the band only once it has been still.
 *
 * Date and time
 * - Given an empty field, a day pressed is written with the clock now on the minute step and the
 *   panel stays open; the time pill swaps in the wheels, which write the time on that day.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import type { ReactElement } from "react";
import { DateField } from "../src/components/forms/date-time/date-field";
import type { DateFieldProps } from "../src/components/forms/date-time/date-field";
import { DateRangeField } from "../src/components/forms/date-time/date-range-field";
import type {
  DateRangeFieldProps,
  DateRangeValue,
} from "../src/components/forms/date-time/date-range-field";
import { DateTimeField } from "../src/components/forms/date-time/date-time-field";
import { TimeField } from "../src/components/forms/date-time/time-field";
import type { TimeFieldProps } from "../src/components/forms/date-time/time-field";
import { Modal } from "../src/components/overlays/modal/modal";
import { DEFAULT_UI_STRINGS, UiStringsProvider } from "../src/strings";
import type { UiStrings } from "../src/strings";
import { fire, mount, unmountAll } from "./helpers/dom";

const NOW = new Date(2026, 10, 12, 14, 37);
const EN = DEFAULT_UI_STRINGS.dates;
const ZH: UiStrings = {
  ...DEFAULT_UI_STRINGS,
  dates: { ...EN, locale: "zh-CN", hour: "小时", minute: "分钟" },
};

const realZone = process.env.TZ;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});
afterEach(async () => {
  await unmountAll();
  vi.useRealTimers();
  if (realZone === undefined) delete process.env.TZ;
  else process.env.TZ = realZone;
});

// --- the page -------------------------------------------------------------------------------

/** A field holding its own value, recording every value it writes. */
function held<T>(
  initial: T,
  render: (value: T, onChange: (next: T, ...rest: unknown[]) => void) => ReactElement,
) {
  const writes: unknown[][] = [];
  function Holder() {
    const [value, setValue] = useState(initial);
    return render(value, (next, ...rest) => {
      writes.push(rest.length === 0 ? [next] : [next, ...rest]);
      setValue(next);
    });
  }
  return { element: createElement(Holder), writes };
}

/** A field's props besides the value it holds. */
type Rest<P> = Partial<Omit<P, "value" | "onChange" | "from" | "to">>;

const dateField = (initial: string, props: Rest<DateFieldProps> = {}) =>
  held(initial, (value, onChange) =>
    createElement(DateField, { label: "Due", value, onChange, ...props }),
  );

const timeField = (initial: string, props: Rest<TimeFieldProps> = {}) =>
  held(initial, (value, onChange) =>
    createElement(TimeField, { label: "Alarm", value, onChange, ...props }),
  );

const rangeField = (initial: DateRangeValue, props: Rest<DateRangeFieldProps> = {}) =>
  held(initial, (value, onChange) =>
    createElement(DateRangeField, {
      label: "Period",
      from: value.from,
      to: value.to,
      onChange,
      ...props,
    }),
  );

const inZh = (element: ReactElement) => createElement(UiStringsProvider, { strings: ZH }, element);

const trigger = () => document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
/** The picker's panel: the dialog that is not a modal one. */
const panel = () => document.querySelector<HTMLElement>('[role="dialog"]:not([aria-modal])');
const grid = () => panel()!.querySelector<HTMLElement>('[role="grid"]')!;
/** The month the grid shows, as its title reads it. */
const shownMonth = () =>
  document.getElementById(grid().getAttribute("aria-labelledby")!)!.textContent;
/** The day button reading `n` in the month on show. */
const day = (n: number) =>
  [...grid().querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === String(n),
  )!;
const buttonNamed = (name: string) =>
  [...panel()!.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === name || b.getAttribute("aria-label") === name,
  )!;
const wheel = (name: string) =>
  panel()!.querySelector<HTMLElement>(`[role="spinbutton"][aria-label="${name}"]`);
const focused = () => document.activeElement as HTMLElement;

const press = async (element: Element) => {
  await act(async () => {
    (element as HTMLElement).click();
  });
};
const key = (target: Element, name: string, init: KeyboardEventInit = {}) =>
  fire(target, new KeyboardEvent("keydown", { key: name, bubbles: true, ...init }));
const type = async (target: Element, text: string) => {
  for (const character of text) await key(target, character);
};

// --- date -----------------------------------------------------------------------------------

describe("a date field", () => {
  it("writes the day pressed, closes and hands the focus back", async () => {
    const field = dateField("");
    await mount(field.element);
    await press(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(shownMonth()).toBe("November 2026");
    expect(focused().textContent).toBe("12");
    expect(focused().getAttribute("aria-current")).toBe("date");
    await press(day(20));
    expect(field.writes).toEqual([["2026-11-20"]]);
    expect(panel()).toBeNull();
    expect(focused()).toBe(trigger());
    expect(trigger().textContent).toBe("Nov 20, 2026");
  });

  it("holds back the days outside its bounds, and Today when today is outside", async () => {
    const field = dateField("", { min: "2026-11-15", max: "2026-11-25" });
    await mount(field.element);
    await press(trigger());
    expect(focused().textContent).toBe("15");
    expect(day(14).getAttribute("aria-disabled")).toBe("true");
    await press(day(14));
    await press(day(26));
    expect(field.writes).toEqual([]);
    expect(panel()).not.toBeNull();
    expect(buttonNamed(EN.today).disabled).toBe(true);
    expect(buttonNamed(EN.previousMonth).disabled).toBe(true);
    expect(buttonNamed(EN.nextMonth).disabled).toBe(true);
    await press(day(25));
    expect(field.writes).toEqual([["2026-11-25"]]);
  });

  it("carries the keyboard's focus across the month's edge and writes it on Enter", async () => {
    const field = dateField("2026-11-30");
    await mount(field.element);
    await press(trigger());
    expect(focused().textContent).toBe("30");
    await key(focused(), "ArrowRight");
    expect(shownMonth()).toBe("December 2026");
    expect(focused().getAttribute("aria-label")).toBe("Tuesday, December 1, 2026");
    await key(focused(), "PageUp");
    expect(shownMonth()).toBe("November 2026");
    // Sunday 1 November; the en-US week runs Sunday to Saturday.
    await key(focused(), "End");
    expect(focused().getAttribute("aria-label")).toBe("Saturday, November 7, 2026");
    await key(focused(), "Enter");
    expect(field.writes).toEqual([["2026-11-07"]]);
    expect(panel()).toBeNull();
  });

  it("brings the month typed on the title's wheels back to the grid", async () => {
    const field = dateField("");
    await mount(field.element);
    await press(trigger());
    const title = buttonNamed(EN.fieldName(EN.chooseMonth, "November 2026"));
    await press(title);
    expect(title.getAttribute("aria-expanded")).toBe("true");
    expect(focused()).toBe(wheel(EN.month));
    await type(wheel(EN.month)!, "3");
    await type(wheel(EN.year)!, "2028");
    await press(buttonNamed(EN.fieldName(EN.chooseMonth, "March 2028")));
    expect(wheel(EN.month)).toBeNull();
    expect(shownMonth()).toBe("March 2028");
    await press(day(29));
    expect(field.writes).toEqual([["2028-03-29"]]);
  });

  it("closes on Escape and leaves the dialog around it open, and on a press outside", async () => {
    const field = dateField("2026-11-03");
    const onClose = vi.fn();
    await mount(
      createElement(Modal, { open: true, title: "Edit", onClose, children: field.element }),
    );
    await press(trigger());
    await key(focused(), "Escape");
    expect(panel()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(focused()).toBe(trigger());
    await press(trigger());
    await fire(document.body, new MouseEvent("mousedown", { bubbles: true }));
    expect(panel()).toBeNull();
    expect(field.writes).toEqual([]);
  });

  it("is emptied by its clear cross", async () => {
    const field = dateField("2026-11-03");
    await mount(field.element);
    const cross = document.querySelector<HTMLButtonElement>(`button[aria-label="${EN.clear}"]`)!;
    await press(cross);
    expect(field.writes).toEqual([[""]]);
    expect(trigger().textContent).toBe(EN.pickDate);
    expect(panel()).toBeNull();
  });

  it("takes today from the reader's calendar, west of Greenwich late in the evening", async () => {
    process.env.TZ = "America/New_York";
    // 03:30 UTC on 13 November is 22:30 on 12 November in New York.
    vi.setSystemTime(new Date("2026-11-13T03:30:00Z"));
    const field = dateField("");
    await mount(field.element);
    await press(trigger());
    expect(grid().querySelector('[aria-current="date"]')?.textContent).toBe("12");
    await press(buttonNamed(EN.today));
    expect(field.writes).toEqual([["2026-11-12"]]);
  });
});

// --- range ----------------------------------------------------------------------------------

describe("a date-range field", () => {
  const presets = [
    { id: "7d", label: "Last 7 days", from: "2026-11-06", to: "2026-11-12" },
    { id: "30d", label: "Last 30 days", from: "2026-10-14", to: "2026-11-12" },
  ];

  it("takes the earlier of two presses as the start, writing only on the second", async () => {
    const field = rangeField({ from: "", to: "" });
    await mount(field.element);
    await press(trigger());
    await press(day(20));
    expect(field.writes).toEqual([]);
    expect(panel()).not.toBeNull();
    await press(day(10));
    expect(field.writes).toEqual([[{ from: "2026-11-10", to: "2026-11-20" }]]);
    expect(panel()).toBeNull();
    expect(trigger().textContent?.replace(/\s/g, " ")).toBe("Nov 10 – 20, 2026");
  });

  it("writes nothing when the panel closes between the two presses", async () => {
    const field = rangeField({ from: "2026-11-01", to: "2026-11-05" });
    await mount(field.element);
    await press(trigger());
    await press(day(20));
    await key(focused(), "Escape");
    expect(field.writes).toEqual([]);
    await press(trigger());
    await press(day(10));
    await press(day(12));
    expect(field.writes).toEqual([[{ from: "2026-11-10", to: "2026-11-12" }]]);
  });

  it("writes a preset with its id, and shows it pressed after", async () => {
    const field = rangeField({ from: "2026-11-01", to: "2026-11-05" }, { presets });
    await mount(field.element);
    await press(trigger());
    await press(buttonNamed("Last 7 days"));
    expect(field.writes).toEqual([[{ from: "2026-11-06", to: "2026-11-12" }, "7d"]]);
    expect(panel()).toBeNull();
    await press(trigger());
    expect(buttonNamed("Last 7 days").getAttribute("aria-pressed")).toBe("true");
    expect(buttonNamed("Last 30 days").getAttribute("aria-pressed")).toBe("false");
  });
});

// --- time -----------------------------------------------------------------------------------

describe("a time field", () => {
  it("steps, jumps and turns a 12-hour clock from the keyboard", async () => {
    const field = timeField("09:30");
    await mount(field.element);
    await press(trigger());
    const hour = wheel(EN.hour)!;
    expect(focused()).toBe(hour);
    expect(hour.getAttribute("aria-valuetext")).toBe("9");
    await key(hour, "ArrowUp");
    await type(hour, "11");
    await type(wheel(EN.dayPeriod)!, "p");
    expect(field.writes).toEqual([["10:30"], ["01:30"], ["11:30"], ["23:30"]]);
    expect(trigger().textContent?.replace(/\s/g, " ")).toBe("11:30 PM");
  });

  it("runs a 24-hour clock with no day-period wheel", async () => {
    const field = timeField("09:30");
    await mount(inZh(field.element));
    await press(trigger());
    expect(wheel(EN.dayPeriod)).toBeNull();
    const hour = wheel("小时")!;
    expect(hour.getAttribute("aria-valuetext")).toBe("09");
    await key(hour, "ArrowDown");
    await type(hour, "14");
    expect(field.writes).toEqual([["08:30"], ["01:30"], ["14:30"]]);
    expect(trigger().textContent).toBe("14:30");
  });

  it("stops the minute wheel at its last step", async () => {
    const field = timeField("09:30", { minuteStep: 15, hourCycle: "h23" });
    await mount(field.element);
    await press(trigger());
    const minute = wheel(EN.minute)!;
    expect(minute.getAttribute("aria-valuemax")).toBe("45");
    await key(minute, "ArrowUp");
    await key(minute, "ArrowUp");
    expect(field.writes).toEqual([["09:45"]]);
  });

  it("writes the row a scroll leaves in the band, once the wheel is still", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], now: NOW });
    const field = timeField("09:30", { hourCycle: "h23" });
    await mount(field.element);
    await press(trigger());
    const minute = wheel(EN.minute)!;
    // The wheel opened with minute 30 in the band: thirty rows down.
    const row = minute.scrollTop / 30;
    expect(row).toBeGreaterThan(0);
    minute.scrollTop = row * 45 + row * 0.4;
    await fire(minute, new Event("scroll"));
    await act(async () => {
      vi.advanceTimersByTime(60);
    });
    expect(field.writes).toEqual([]);
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(field.writes).toEqual([["09:45"]]);
  });
});

// --- date and time --------------------------------------------------------------------------

describe("a date-and-time field", () => {
  it("writes a day with the clock now, then the time the wheels turn to", async () => {
    const field = held("", (value, onChange) =>
      createElement(DateTimeField, { label: "Start", value, onChange, minuteStep: 5 }),
    );
    await mount(field.element);
    await press(trigger());
    await press(day(20));
    expect(field.writes).toEqual([["2026-11-20T14:35"]]);
    expect(panel()).not.toBeNull();
    const pill = panel()!.querySelector<HTMLButtonElement>("button[aria-pressed]")!;
    expect(pill.getAttribute("aria-label")?.replace(/\s/g, " ")).toBe("Time: 2:35 PM");
    await press(pill);
    expect(focused()).toBe(wheel(EN.hour));
    await key(focused(), "ArrowUp");
    expect(field.writes).toEqual([["2026-11-20T14:35"], ["2026-11-20T15:35"]]);
    await press(pill);
    expect(wheel(EN.hour)).toBeNull();
    expect(day(20).getAttribute("aria-label")).toBe("Friday, November 20, 2026");
  });
});
