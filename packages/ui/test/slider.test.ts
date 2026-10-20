/**
 * Slider (src/components/forms/slider/slider.tsx): a native range input on the theme's roles, with
 * a readout of the value and its unit beside it.
 *
 * - Given a value, the slider is a native range — so the browser reports it as a slider with its
 *   value, minimum and maximum — named by its title, carrying the bounds and the step.
 * - The readout shows the value at the step's precision, with the unit, and the words read out
 *   for the value are the same; a caller's decimals win over the step's; a value outside the
 *   range reads as the bound the thumb stops at. The readout itself is hidden from assistive
 *   technology, which hears the value from the slider.
 * - Disabled, the slider takes no input and its row dims.
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
/** The readout: the hidden span after the input, as text. */
const readout = (html: string) =>
  (
    /<\/?input[^>]*>\s*<span aria-hidden="true"[^>]*>(.*?)<\/span><\/div>/.exec(html)?.[1] ?? ""
  ).replace(/<[^>]*>/g, "");
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
    expect(readout(html)).toBe("60 %");
    expect(range(html)).toContain('aria-valuetext="60 %"');
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

  it("disabled, takes no input and dims its row", () => {
    const html = render({ disabled: true });
    expect(range(html)).toContain('disabled=""');
    expect(classTokens(html)).toContain("opacity-60");
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
