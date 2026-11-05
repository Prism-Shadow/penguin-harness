/**
 * Slider (src/components/forms/slider/slider.tsx): a native range input on the theme's roles, with
 * a readout of the value and its unit beside it.
 *
 * - Given a value, the slider is a native range — so the browser reports it as a slider with its
 *   value, minimum and maximum — named by its title, carrying the bounds and the step.
 * - The readout shows the value at the step's precision, with the unit — a percent or a degree
 *   tight to the figure, any other unit after a space — and the words read out for the value
 *   are the same; a caller's decimals win over the step's; a value outside the
 *   range reads as the bound the thumb stops at. The readout itself is hidden from assistive
 *   technology, which hears the value from the slider.
 * - The track is filled in the accent up to the value — none at the minimum, all at the maximum,
 *   the bound for a value outside the range — over the switch's track for the rest.
 * - Disabled, the slider takes no input, its fill and thumb turn grey, and its row dims.
 * - Given a hint, the slider points at it; given an error, it takes the hint's place, the slider
 *   points at it and is marked invalid, and the thumb's line turns to the danger ink.
 * - Required, the title carries the mark; a slider always holds a value, so nothing claims an
 *   `aria-required` the slider role does not take.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Slider } from "../src/components/forms/slider/slider";
import type { SliderProps } from "../src/components/forms/slider/slider";
import { classTokens, renderStatic } from "../src/testing";

const render = (props: Partial<SliderProps> = {}) =>
  renderStatic(
    createElement(Slider, {
      label: "Temperature",
      value: 0.7,
      onChange: () => {},
      min: 0,
      max: 1,
      step: 0.1,
      ...props,
    }),
  );

/** The range input's opening tag. */
const range = (html: string) => /<input[^>]*type="range"[^>]*>/.exec(html)?.[0] ?? "";
/** The readout: the hidden span of tabular figures beside the track, as text. */
const readout = (html: string) =>
  (
    /<span aria-hidden="true" class="[^"]*tabular-nums[^"]*">(.*?)<\/span><\/div>/.exec(
      html,
    )?.[1] ?? ""
  ).replace(/<[^>]*>/g, "");
/** The drawn track's fill: its classes and the share of the range its width stands for. */
function fill(html: string): { classes: string; share: number } {
  const tag = /<span aria-hidden="true" data-track="fill"[^>]*>/.exec(html)?.[0] ?? "";
  const share = /\* ([0-9.]+) \+/.exec(tag)?.[1];
  return { classes: /class="([^"]*)"/.exec(tag)?.[1] ?? "", share: Number(share ?? Number.NaN) };
}
/** The text of the element the slider's description points at. */
function described(html: string): string {
  const id = /aria-describedby="([^"]+)"/.exec(range(html))?.[1];
  if (id === undefined) return "";
  const at = html.indexOf(`id="${id}"`);
  return at < 0 ? "" : html.slice(html.indexOf(">", at) + 1).replace(/<[^>]*>/g, "");
}

describe("the slider", () => {
  it("is a native range named by its title, carrying its bounds, step and value", () => {
    const html = render();
    const tag = range(html);
    const id = /id="([^"]+)"/.exec(tag)?.[1];
    expect(html).toContain(`<label for="${id}"`);
    expect(tag).toMatch(/min="0"/);
    expect(tag).toMatch(/max="1"/);
    expect(tag).toMatch(/step="0.1"/);
    expect(tag).toMatch(/value="0.7"/);
    expect(html).toMatch(/^<div class="min-w-0" data-control="slider">/);
  });

  it("reads out the value at the step's precision with its unit, and says the same words", () => {
    const html = render({ value: 60, min: 0, max: 100, step: 5, unit: "%" });
    expect(readout(html)).toBe("60%");
    expect(range(html)).toContain('aria-valuetext="60%"');
    const spaced = render({ unit: "dB" });
    expect(readout(spaced)).toBe("0.7 dB");
    expect(range(spaced)).toContain('aria-valuetext="0.7 dB"');
    const plain = render({ value: 0.70000001 });
    expect(readout(plain)).toBe("0.7");
    expect(range(plain)).toContain('aria-valuetext="0.7"');
  });

  it("takes the caller's decimals over the step's", () => {
    expect(readout(render({ value: 0.5, decimals: 2 }))).toBe("0.50");
    expect(readout(render({ value: 3, min: 0, max: 10, step: undefined }))).toBe("3");
  });

  it("reads a value outside the range as the bound the thumb stops at", () => {
    expect(readout(render({ value: 4 }))).toBe("1.0");
    expect(range(render({ value: -2 }))).toContain('aria-valuetext="0.0"');
  });

  it("hides the readout from assistive technology, which hears the slider's own value", () => {
    expect(render()).toMatch(/<span aria-hidden="true" class="[^"]*tabular-nums[^"]*">/);
  });

  it("fills the track in the accent up to the value, over the switch's track", () => {
    const html = render({ value: 60, min: 0, max: 100, step: 5 });
    expect(fill(html).share).toBe(0.6);
    expect(fill(html).classes.split(" ")).toContain("bg-accent");
    expect(html).toMatch(/<span aria-hidden="true" data-track="rest" class="[^"]*bg-switch-track/);
    expect(fill(render({ value: 0 })).share).toBe(0);
    expect(fill(render({ value: 1 })).share).toBe(1);
    expect(fill(render({ value: 7 })).share).toBe(1);
    expect(fill(render({ value: 0.5, min: 0.5, max: 0.5 })).share).toBe(0);
  });

  it("disabled, takes no input, greys its fill and thumb, and dims its row", () => {
    const html = render({ disabled: true });
    expect(range(html)).toContain('disabled=""');
    expect(classTokens(html)).toContain("opacity-60");
    expect(fill(html).classes.split(" ")).toContain("bg-fg-muted");
    expect(fill(html).classes.split(" ")).not.toContain("bg-accent");
    expect(range(html)).toContain("slider-thumb]:bg-fg-muted");
    expect(range(render())).toContain("slider-thumb]:bg-accent");
  });

  it("points at its hint, and at an error instead, which marks it invalid", () => {
    const hinted = render({ hint: "Lower is steadier" });
    expect(described(hinted)).toBe("Lower is steadier");
    expect(range(hinted)).not.toContain("aria-invalid");
    const refused = render({ hint: "Lower is steadier", error: "Not a valid value" });
    expect(described(refused)).toBe("Not a valid value");
    expect(range(refused)).toContain('aria-invalid="true"');
    // The thumb's line turns to the danger ink, and only while the value is refused.
    expect(refused).toContain("slider-thumb]:border-tone-danger-fg");
    expect(hinted).not.toContain("border-tone-danger-fg");
    expect(refused).not.toContain("Lower is steadier");
    expect(range(render())).not.toContain("aria-describedby");
  });

  it("marks a required title, and claims no aria-required for the slider", () => {
    const html = render({ required: true });
    expect(html).toMatch(/<label[^>]*>Temperature<span[^>]*aria-hidden="true">\*<\/span>/);
    expect(range(html)).not.toContain("aria-required");
  });
});
