/**
 * Drives the shared UI package's date and time pickers the way a person does: open the field,
 * pick the year and the month from the calendar head's menus, press the day, and type the hour
 * and the minute on the time wheels. The pickers speak the package's English words in
 * these suites, which mount no strings provider.
 */
import { act } from "react";
import { DEFAULT_UI_STRINGS } from "@prismshadow/penguin-ui";
import { click } from "./dom";

const WORDS = DEFAULT_UI_STRINGS.dates;
/** The month menu's options, as the package's English names them. */
const MONTHS = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat(WORDS.locale, { month: "long", timeZone: "UTC" }).format(
    Date.UTC(2026, month, 1),
  ),
);

/** The picker in `scope` titled `title`: its name is the title and what it shows. */
export function pickerIn(scope: ParentNode, title: string): HTMLButtonElement {
  const found = [
    ...scope.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"]'),
  ].find((button) => button.getAttribute("aria-label")?.startsWith(`${title}: `));
  if (found === undefined) throw new Error(`no picker titled ${JSON.stringify(title)}`);
  return found;
}

/** The open picker's panel: the dialog that is not a modal one. */
function panel(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[role="dialog"]:not([aria-modal])');
  if (found === null) throw new Error("no picker panel open");
  return found;
}

function buttonStarting(scope: ParentNode, name: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.getAttribute("aria-label")?.startsWith(name),
  );
  if (found === undefined) throw new Error(`no button named ${JSON.stringify(name)}`);
  return found;
}

function wheel(name: string): HTMLElement | null {
  return panel().querySelector<HTMLElement>(`[role="spinbutton"][aria-label="${name}"]`);
}

/** Types `text` on `target` a key at a time, as the wheels read typed digits and letters. */
async function typeKeys(target: Element | null, text: string): Promise<void> {
  if (target === null) throw new Error("no wheel to type on");
  for (const key of text) {
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
  }
}

/** Presses the option reading `label` in the menu the calendar's head has open. */
async function pickOption(label: string): Promise<void> {
  const found = [...panel().querySelectorAll<HTMLElement>('[role="option"]')].find(
    (option) => option.textContent === label,
  );
  if (found === undefined) throw new Error(`no ${JSON.stringify(label)} in the open menu`);
  await click(found);
}

/** Turns the open calendar to the month of `date` through its year and month menus and presses its day. */
async function pickDay(date: string): Promise<void> {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  await click(buttonStarting(panel(), `${WORDS.year}: `));
  await pickOption(String(year));
  await click(buttonStarting(panel(), `${WORDS.month}: `));
  await pickOption(MONTHS[month - 1]!);
  const grid = panel().querySelector('[role="grid"]');
  const button = [...(grid?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (each) => each.textContent === String(day),
  );
  if (button === undefined) throw new Error(`no day ${day} on the calendar`);
  await click(button);
}

/** Closes the open panel with Escape, from inside it, as a keyboard does. */
async function closePanel(): Promise<void> {
  const inside = document.activeElement ?? panel();
  await act(async () => {
    inside.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

/** Sets the date picker titled `title` to `value` (`YYYY-MM-DD`). */
export async function pickDate(scope: ParentNode, title: string, value: string): Promise<void> {
  await click(pickerIn(scope, title));
  await pickDay(value);
}

/** Sets the date-and-time picker titled `title` to `value` (`YYYY-MM-DDTHH:mm`). */
export async function pickDateTime(scope: ParentNode, title: string, value: string): Promise<void> {
  const [date, time] = value.split("T") as [string, string];
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  await click(pickerIn(scope, title));
  await pickDay(date);
  const pill = panel().querySelector<HTMLButtonElement>("button[aria-pressed]");
  if (pill === null) throw new Error("no time pill under the calendar");
  await click(pill);
  const period = wheel(WORDS.dayPeriod);
  await typeKeys(wheel(WORDS.hour), String(period === null ? hour : hour % 12 || 12));
  if (period !== null) await typeKeys(period, hour < 12 ? "a" : "p");
  await typeKeys(wheel(WORDS.minute), String(minute));
  await closePanel();
}
