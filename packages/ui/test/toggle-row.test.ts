/**
 * ToggleRow (src/components/forms/toggle-row/toggle-row.tsx): a label, its "?" and hint beside a
 * Switch, in three frames. The row is never a `<label>` (it would name the "?" rather than the
 * switch), so the switch is named by the row's label instead.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ToggleRow } from "../src/components/forms/toggle-row/toggle-row";
import type { ToggleRowVariant } from "../src/components/forms/toggle-row/toggle-row";
import { classTokens, renderStatic } from "../src/testing";

const render = (variant?: ToggleRowVariant, extra: Record<string, unknown> = {}) =>
  renderStatic(
    createElement(ToggleRow, {
      label: "Notify when done",
      checked: true,
      onChange: () => {},
      ...(variant !== undefined ? { variant } : {}),
      ...extra,
    }),
  );

/** The class tokens of the row's own element, not its children's. */
const frame = (html: string) => classTokens(/^<[^>]+>/.exec(html)?.[0] ?? "");

describe("ToggleRow", () => {
  it("names its switch by the row's label, and never wraps the row in a label", () => {
    for (const variant of ["row", "plain", "card"] as const) {
      const html = render(variant, { info: "A system notification when a Task ends." });
      expect(html, variant).toContain('role="switch"');
      expect(html, variant).toContain('aria-label="Notify when done"');
      expect(html, variant).not.toContain("<label");
      // The "?" folds the subject into its own name and keeps its text until opened.
      expect(html, variant).toContain('aria-label="More info: Notify when done"');
      expect(html, variant).not.toContain("A system notification");
    }
  });

  it("keeps the hint on screen under the label", () => {
    const html = render("plain", { hint: "Takes effect once saved." });
    expect(html.indexOf("Notify when done")).toBeLessThan(html.indexOf("Takes effect once saved."));
  });

  it("is a preference row in a ruled list, a bare row in a stack, a hairline box alone", () => {
    expect(frame(render())).toEqual(expect.arrayContaining(["ui-field", "py-3.5"]));
    expect(render()).toContain('data-slot="label"');
    expect(render()).toContain('data-slot="control"');
    const plain = frame(render("plain"));
    expect(plain).not.toContain("ui-field");
    expect(plain).not.toContain("border");
    expect(frame(render("card"))).toEqual(
      expect.arrayContaining(["border", "border-line", "rounded-lg"]),
    );
  });

  it("passes the disabled state to the switch", () => {
    expect(render("row", { disabled: true })).toContain('disabled=""');
  });
});
