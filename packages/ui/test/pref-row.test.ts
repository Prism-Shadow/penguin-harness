/**
 * The settings rows (src/components/forms/pref-row/pref-row.tsx): PrefRow, SettingRow and the
 * SettingsSection frame.
 *
 * A settings row titles a control it does not own, so its title is a `<p>` and the "?" is safe
 * beside it. An edit that made that title a `<label>` for the sake of click-to-toggle would hand
 * the row to the trigger instead — the same trap Field carries two layouts to avoid, on the one
 * row primitive that has no Field between it and the control.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  PrefRow,
  SettingRow,
  SettingsGroup,
  SettingsSection,
} from "../src/components/forms/pref-row/pref-row";
import { Switch } from "../src/components/forms/switch/switch";
import { classTokens, renderStatic } from "../src/testing";

describe("PrefRow", () => {
  const row = renderStatic(
    createElement(PrefRow, {
      label: "Theme",
      hint: "Applies at once.",
      info: "Light or dark look of the app.",
      children: createElement(Switch, { checked: true, onChange: () => {} }),
    }),
  );

  it("is a field row whose children are the label and control slots", () => {
    expect(row).toMatch(/^<div class="ui-field [^"]*"><div data-slot="label"/);
    expect(row).toContain('<div data-slot="control"');
  });

  it('keeps the row out of a label, so the "?" cannot toggle its control', () => {
    expect(row).not.toContain("<label");
    expect(row).toContain('role="switch"');
  });

  it("anchors the trigger to the row title and keeps the hint on screen", () => {
    expect(row).toContain('aria-label="More info: Theme"');
    expect(row).not.toContain("Light or dark look of the app.");
    expect(row).toContain("Applies at once.");
  });

  it("holds every row to the settings line, the hint in its own slot under the one-line title", () => {
    // The line is the Segmented well's height, so a switch row and a segmented row are one pitch.
    const line =
      "min-h-[calc(var(--ui-space-unit)*4_+_var(--ui-text-small-size)*var(--ui-text-small-lh))]";
    const slot = (name: string) =>
      (new RegExp(`data-slot="${name}" class="([^"]*)"`).exec(row)?.[1] ?? "").split(" ");
    expect(slot("control")).toEqual(expect.arrayContaining([line, "items-center", "row-span-2"]));
    expect(slot("label")).toContain("whitespace-nowrap");
    expect(slot("hint")).toEqual(expect.arrayContaining(["col-start-1", "row-start-2"]));
  });
});

describe("SettingsGroup", () => {
  it("stacks its rows in a ruled list, under a heading on the eyebrow rung when titled", () => {
    const rows = createElement("p", null, "Row");
    const bare = renderStatic(createElement(SettingsGroup, { children: rows }));
    expect(bare).toBe('<div class="divide-y divide-line-muted"><p>Row</p></div>');
    const titled = renderStatic(
      createElement(SettingsGroup, { title: "Terminal", children: rows }),
    );
    expect(titled).toMatch(/<h3[^>]*><span class="ui-eyebrow [^"]*">Terminal<\/span><\/h3>/);
    expect(titled).toContain('<div class="divide-y divide-line-muted"><p>Row</p></div>');
  });
});

describe("SettingRow", () => {
  it("draws its description in the subtle ink, and no control slot when it has none", () => {
    const bare = renderStatic(
      createElement(SettingRow, { title: "Delete project", description: "Not the last one." }),
    );
    expect(classTokens(bare)).toContain("text-fg-subtle");
    expect(bare).not.toContain("shrink-0");
    const withControl = renderStatic(
      createElement(SettingRow, { title: "Name" }, createElement("button", null, "Save")),
    );
    expect(withControl).toContain("<button>Save</button>");
  });
});

describe("SettingsSection", () => {
  it("draws the ruled action row only when there are actions", () => {
    const body = createElement("p", null, "Body");
    expect(renderStatic(createElement(SettingsSection, { children: body }))).not.toContain(
      "border-t",
    );
    const saved = renderStatic(
      createElement(SettingsSection, {
        actions: createElement("button", null, "Save"),
        children: body,
      }),
    );
    expect(classTokens(saved)).toEqual(expect.arrayContaining(["border-t", "border-line-muted"]));
    expect(saved.indexOf("Body")).toBeLessThan(saved.indexOf("Save"));
  });
});
