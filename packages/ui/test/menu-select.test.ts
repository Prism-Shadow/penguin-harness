/**
 * The toolbar select (src/components/chat/menu-select/menu-select.tsx): a toolbar trigger over a
 * portaled menu. The open panel's contents are `MenuSelectBody`, rendered here on their own (a
 * static render has no `document.body` to portal into): a title bar naming the control, rows that
 * stay plain buttons named by the choices, the check on the chosen one, toggles marked pressed,
 * a muted detail after a label, and a footnote or a settings footer under a rule.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { MenuSelect, MenuSelectBody } from "../src/components/chat/menu-select/menu-select";
import { classTokens, renderStatic } from "../src/testing";

const LEVELS = [
  { value: "low", label: "Low" },
  { value: "high", label: "High" },
];

describe("MenuSelectBody", () => {
  it("names the control in a title bar and checks the chosen row", () => {
    const html = renderStatic(
      createElement(MenuSelectBody<string>, {
        title: "Thinking level",
        options: LEVELS,
        value: "high",
        note: "Changing it costs the cached context.",
      }),
    );
    expect(html.indexOf("Thinking level")).toBeLessThan(html.indexOf("Low"));
    const rows = html.split("<button").slice(1);
    expect(rows).toHaveLength(2);
    // Plain buttons named by the choice: the pickers are found by these names.
    expect(rows.every((row) => !row.includes("role="))).toBe(true);
    expect(rows[0]).not.toContain("<svg");
    expect(rows[1]).toContain("<svg");
    expect(html.indexOf("High")).toBeLessThan(html.indexOf("Changing it costs"));
    expect(classTokens(html)).toEqual(expect.arrayContaining(["text-xs", "text-fg-subtle"]));
  });

  it("marks every toggle's state, and runs a muted detail after its label", () => {
    const html = renderStatic(
      createElement(MenuSelectBody<string>, {
        options: [
          { value: "image", label: "Image", detail: "Attach a picture" },
          { value: "goal", label: "Goal", detail: "Loop until done", disabled: true },
        ],
        value: ["goal"],
        multiple: true,
        footer: createElement("div", null, "SETTINGS"),
      }),
    );
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('<span class="text-fg-subtle">Attach a picture</span>');
    expect(html).toContain('disabled=""');
    expect(html.indexOf("Loop until done")).toBeLessThan(html.indexOf("SETTINGS"));
  });

  it("draws the caller's body in place of the rows", () => {
    const html = renderStatic(
      createElement(MenuSelectBody<string>, { children: createElement("p", null, "LIST") }),
    );
    expect(html).toBe("<p>LIST</p>");
  });
});

describe("MenuSelect", () => {
  it("renders only its trigger while closed, reporting the closed state", () => {
    const html = renderStatic(
      createElement(MenuSelect<string>, {
        trigger: { glyph: "M12 5v14", label: "High", caret: true, ariaLabel: "Thinking level" },
        options: LEVELS,
        value: "high",
      }),
    );
    expect(html).toContain('aria-label="Thinking level"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Low");
  });
});
