/**
 * Kbd: a shortcut as HTML's key-combination markup, one key cap per key, in tokens.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Kbd } from "../src/components/actions/kbd/kbd";
import { renderStatic } from "../src/testing";

describe("Kbd", () => {
  it("nests one key cap per key, in order, inside the combination", () => {
    const html = renderStatic(createElement(Kbd, { keys: ["Ctrl", "`"] }));
    expect(html).toMatch(
      /^<kbd class="[^"]*"><kbd class="[^"]*">Ctrl<\/kbd><kbd class="[^"]*">`<\/kbd><\/kbd>$/,
    );
  });

  it("draws the plain look as keys joined by +", () => {
    const html = renderStatic(createElement(Kbd, { keys: ["Ctrl", "W"], variant: "plain" }));
    expect(html).toMatch(
      /^<kbd class="[^"]*"><kbd>Ctrl<\/kbd><span aria-hidden="true">\+<\/span><kbd>W<\/kbd><\/kbd>$/,
    );
  });
});
