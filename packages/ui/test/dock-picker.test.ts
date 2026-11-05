/**
 * DockPicker (src/components/shell/dock-picker/dock-picker.tsx): an empty dock's choices, laid
 * out as a list or a row, with a shortcut as key caps.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { DockPicker } from "../src/components/shell/dock-picker/dock-picker";
import { classTokens, renderStatic } from "../src/testing";

describe("DockPicker", () => {
  const render = (horizontal: boolean) =>
    renderStatic(
      createElement(DockPicker, {
        horizontal,
        choices: [
          { key: "agents", label: "Agents", glyph: "A", onChoose: () => {} },
          {
            key: "terminal",
            label: "Terminal",
            glyph: "T",
            keys: ["Ctrl", "`"],
            onChoose: () => {},
          },
        ],
      }),
    );

  it("renders one button per choice, and a shortcut as key caps", () => {
    const html = render(false);
    expect(html).toContain('data-testid="dock-pick-agents"');
    expect(html).toContain('data-testid="dock-pick-terminal"');
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain("<kbd");
    expect(html).toMatch(/>Ctrl<\/kbd><kbd[^>]*>`<\/kbd>/);
  });

  it("stacks the choices on the right dock and wraps them in a row on the bottom one", () => {
    expect(classTokens(render(false))).toEqual(expect.arrayContaining(["flex-col", "w-60"]));
    expect(classTokens(render(true))).toEqual(expect.arrayContaining(["flex-wrap"]));
    expect(classTokens(render(true))).not.toContain("flex-col");
  });
});
