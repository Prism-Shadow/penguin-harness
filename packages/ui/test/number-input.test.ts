/**
 * NumberInput (src/components/forms/number-input/): a number box with its unit inside, a minus and
 * a plus that step it within its bounds, and the range — or the caller's hint, or the error —
 * under it.
 *
 * Static markup for what each state draws; the step arithmetic is pure and called directly.
 *
 * - Given a value, the box is a number input named by its title, with the unit drawn inside it
 *   and the range under it, which the box points at as its description.
 * - Given a value at a bound, the button that would pass it is disabled and the other is not;
 *   disabled, the box and both buttons take no input; the buttons are named by the caller and
 *   never submit the form around them.
 * - When a step is pressed, the value moves by one step, from 0 when the box is empty or
 *   malformed, rounded to the step's precision and clamped to the range; a typed value already
 *   at or past a bound cannot step further that way, an empty box always can.
 * - Given an error, it takes the hint's place, is what the box's description points at, and
 *   marks the box invalid; a caller's hint replaces the range, and a field with no bounds and no
 *   hint has nothing under it.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { NumberInput } from "../src/components/forms/number-input/number-input";
import type { NumberInputProps } from "../src/components/forms/number-input/number-input";
import {
  rangeText,
  stepBlocked,
  stepNumber,
} from "../src/components/forms/number-input/number-step";
import { renderStatic } from "../src/testing";

const render = (props: Partial<NumberInputProps> = {}) =>
  renderStatic(
    createElement(NumberInput, {
      label: "Replicas",
      value: "3",
      onChange: () => {},
      min: 1,
      max: 10,
      unit: "pods",
      stepLabels: { up: "Increase", down: "Decrease" },
      ...props,
    }),
  );

/** The number box's opening tag. */
const box = (html: string) => /<input[^>]*type="number"[^>]*>/.exec(html)?.[0] ?? "";
/** The two step buttons' opening tags, minus first. */
const steps = (html: string): string[] => html.match(/<button\b[^>]*>/g) ?? [];
/** What sits under the box: the element the box's description points at, and its text. */
function described(html: string): string {
  const id = /aria-describedby="([^"]+)"/.exec(box(html))?.[1];
  if (id === undefined) return "";
  const at = html.indexOf(`id="${id}"`);
  // The element is the markup's last: its text is everything after its own opening tag.
  return at < 0 ? "" : html.slice(html.indexOf(">", at) + 1).replace(/<[^>]*>/g, "");
}

describe("the number box", () => {
  it("is a number input named by its title, with the unit inside and the range described", () => {
    const html = render();
    const id = /id="([^"]+)"/.exec(box(html))?.[1];
    expect(html).toContain(`<label for="${id}"`);
    expect(box(html)).toMatch(/min="1"[^>]*max="10"/);
    expect(box(html)).toContain('value="3"');
    expect(html).toMatch(/<span[^>]*>pods<\/span>/);
    expect(described(html)).toBe("1–10");
    expect(html).toMatch(/^<div class="min-w-0" data-control="number-input">/);
  });

  it("keeps the caller's own description beside the range's", () => {
    const html = render({ "aria-describedby": "outside" });
    expect(box(html)).toMatch(/aria-describedby="outside [^"]+"/);
  });
});

describe("the stepper", () => {
  it("disables the plus at the top of the range and the minus at the bottom", () => {
    const top = steps(render({ value: "10" }));
    expect(top.map((tag) => tag.includes('disabled=""'))).toEqual([false, true]);
    const bottom = steps(render({ value: "1" }));
    expect(bottom.map((tag) => tag.includes('disabled=""'))).toEqual([true, false]);
    const middle = steps(render({ value: "4" }));
    expect(middle.map((tag) => tag.includes('disabled=""'))).toEqual([false, false]);
  });

  it("disabled, takes no input in the box or on either button", () => {
    const html = render({ disabled: true, value: "4" });
    expect(box(html)).toContain('disabled=""');
    for (const tag of steps(html)) expect(tag).toContain('disabled=""');
  });

  it("names its buttons with the caller's words, and never submits the form around it", () => {
    const [down, up] = steps(render());
    expect(down).toContain('aria-label="Decrease"');
    expect(up).toContain('aria-label="Increase"');
    for (const tag of [down, up]) expect(tag).toContain('type="button"');
  });

  it("steps from an empty or malformed box as if it held 0, within the range", () => {
    expect(stepNumber("", { step: 1 }, 1)).toBe("1");
    expect(stepNumber("abc", { step: 5 }, -1)).toBe("-5");
    expect(stepNumber("", { min: 3, max: 10 }, 1)).toBe("3");
  });

  it("keeps the step's precision, so 0.1 + 0.2 lands on 0.3", () => {
    expect(stepNumber("0.2", { step: 0.1 }, 1)).toBe("0.3");
    expect(stepNumber("1", { step: 0.25 }, -1)).toBe("0.75");
    expect(stepNumber("2.5", {}, 1)).toBe("3.5");
  });

  it("stops at the bounds, and pulls a value typed past one back onto it", () => {
    expect(stepNumber("10", { min: 1, max: 10 }, 1)).toBe("10");
    expect(stepNumber("12", { min: 1, max: 10 }, -1)).toBe("10");
    expect(stepNumber("1", { min: 1, max: 10 }, -1)).toBe("1");
  });

  it("blocks a step only where the typed value already sits at or past that bound", () => {
    expect(stepBlocked("10", { max: 10 }, 1)).toBe(true);
    expect(stepBlocked("12", { max: 10 }, 1)).toBe(true);
    expect(stepBlocked("12", { max: 10 }, -1)).toBe(false);
    expect(stepBlocked("0", { min: 0 }, -1)).toBe(true);
    expect(stepBlocked("", { min: 0, max: 0 }, 1)).toBe(false);
    expect(stepBlocked("5", {}, 1)).toBe(false);
  });
});

describe("the line under the box", () => {
  it("shows an error in the hint's place, points the box at it, and marks the box invalid", () => {
    const html = render({ value: "12", error: "At most 10 pods" });
    expect(box(html)).toContain('aria-invalid="true"');
    expect(described(html)).toBe("At most 10 pods");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("1–10");
  });

  it("shows the caller's hint in place of the range", () => {
    const html = render({ hint: "One pod per zone" });
    expect(described(html)).toBe("One pod per zone");
    expect(html).not.toContain("1–10");
    expect(box(html)).not.toContain("aria-invalid");
  });

  it("writes each range in symbols, and nothing for a field with no bounds and no hint", () => {
    expect(rangeText({ min: 1, max: 10 })).toBe("1–10");
    expect(rangeText({ min: 0 })).toBe("≥ 0");
    expect(rangeText({ max: 100 })).toBe("≤ 100");
    expect(rangeText({})).toBeUndefined();
    const bare = render({ min: undefined, max: undefined });
    expect(box(bare)).not.toContain("aria-describedby");
  });
});
