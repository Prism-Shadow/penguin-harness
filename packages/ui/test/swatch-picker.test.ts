/**
 * SwatchPicker (src/components/forms/swatch-picker/swatch-picker.tsx): round swatches from data,
 * each a toggle named by its label, the one in effect pressed and ringed, nothing that grows.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { SwatchPicker } from "../src/components/forms/swatch-picker/swatch-picker";
import { classTokens, renderStatic } from "../src/testing";

const html = renderStatic(
  createElement(SwatchPicker<"blue" | "rose">, {
    options: [
      { value: "blue", color: "rgb(37, 99, 235)", label: "Blue" },
      { value: "rose", color: "rgb(190, 18, 60)", label: "Rose" },
    ],
    value: "rose",
    onChange: () => {},
  }),
);
const buttons = html.split("<button").slice(1);

describe("SwatchPicker", () => {
  it("names each swatch by its label, in the tooltip too, and presses the one in effect", () => {
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toContain('data-tooltip="Blue" aria-label="Blue" aria-pressed="false"');
    expect(buttons[1]).toContain('data-tooltip="Rose" aria-label="Rose" aria-pressed="true"');
  });

  it("paints each swatch its own colour", () => {
    expect(buttons[0]).toContain('style="background-color:rgb(37, 99, 235)"');
  });

  it("rings the chosen swatch in token inks, and never scales one", () => {
    expect(classTokens(`<b${buttons[1]!}`)).toEqual(
      expect.arrayContaining(["ring-2", "border-fg-muted"]),
    );
    expect(classTokens(html).filter((token) => /scale|transition-transform/.test(token))).toEqual(
      [],
    );
  });
});
