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
import { renderStatic, markupStructure } from "../src/testing";

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
});

describe("SettingsGroup", () => {
  it("stacks its rows in a ruled list, under a heading on the eyebrow rung when titled", () => {
    const rows = createElement("p", null, "Row");
    const bare = renderStatic(createElement(SettingsGroup, { children: rows }));
    expect(markupStructure(bare)).toBe("<div><p>Row</p></div>");
    const titled = renderStatic(
      createElement(SettingsGroup, { title: "Terminal", children: rows }),
    );
    expect(titled).toMatch(/<h3[^>]*><span class="ui-eyebrow [^"]*">Terminal<\/span><\/h3>/);
    expect(markupStructure(titled)).toContain("<div><p>Row</p></div>");
  });
});

describe("SettingRow", () => {
  it("sets its description under the title, and none when it has none", () => {
    const described = renderStatic(
      createElement(SettingRow, { title: "Name", description: "Shown to the team" }),
    );
    expect(markupStructure(described)).toContain("<p>Name</p><p>Shown to the team</p>");
    expect(
      markupStructure(renderStatic(createElement(SettingRow, { title: "Name" }))),
    ).not.toContain("<p>Name</p><p>");
  });

  it("holds the control it is given", () => {
    const withControl = renderStatic(
      createElement(SettingRow, { title: "Name" }, createElement("button", null, "Save")),
    );
    expect(withControl).toContain("<button>Save</button>");
  });
});

describe("SettingsSection", () => {
  it("puts the actions after the body", () => {
    const body = createElement("p", null, "Body");
    const saved = renderStatic(
      createElement(SettingsSection, {
        actions: createElement("button", null, "Save"),
        children: body,
      }),
    );
    expect(saved.indexOf("Body")).toBeLessThan(saved.indexOf("Save"));
  });
});
