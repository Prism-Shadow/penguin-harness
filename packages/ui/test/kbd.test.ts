/**
 * Kbd: a shortcut as HTML's key-combination markup, one key cap per key, in tokens.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Kbd } from "../src/components/actions/kbd/kbd";
import { classTokens, renderStatic } from "../src/testing";

describe("Kbd", () => {
  it("nests one key cap per key, in order, inside the combination", () => {
    const html = renderStatic(createElement(Kbd, { keys: ["Ctrl", "`"] }));
    expect(html).toMatch(
      /^<kbd class="[^"]*"><kbd class="[^"]*">Ctrl<\/kbd><kbd class="[^"]*">`<\/kbd><\/kbd>$/,
    );
  });

  it("draws the caps in tokens, in the mono face at the small rung", () => {
    const tokens = classTokens(renderStatic(createElement(Kbd, { keys: ["Esc"] })));
    expect(tokens).toEqual(
      expect.arrayContaining([
        "font-mono",
        "text-xs",
        "bg-surface-inset",
        "border-line",
        "rounded-sm",
      ]),
    );
  });

  it("draws the plain look as mono text joined by +, with no cap chrome", () => {
    const html = renderStatic(createElement(Kbd, { keys: ["Ctrl", "W"], variant: "plain" }));
    expect(html).toMatch(
      /^<kbd class="[^"]*"><kbd>Ctrl<\/kbd><span aria-hidden="true">\+<\/span><kbd>W<\/kbd><\/kbd>$/,
    );
    const tokens = classTokens(html);
    expect(tokens).toEqual(expect.arrayContaining(["font-mono", "text-xs"]));
    expect(tokens).not.toContain("border-line");
  });
});
