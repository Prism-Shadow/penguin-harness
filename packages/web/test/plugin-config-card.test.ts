/**
 * Two things the Sandbox card draws from its entry and draft.
 *
 * - Given a notice tied to a switch (`onlyWhen`), the heading shows it only while that field's
 *   draft is on; a notice tied to nothing always shows.
 * - Given a table row whose name was never changed, the name box holds the declared name as
 *   its value (normal ink, not a placeholder); a renamed row holds the new name.
 * - Given described columns and a described group, every header and the card title carry a "?"
 *   and no description is a paragraph on screen.
 * - Given a pin column, each cell is a toggle button whose pressed state is the row's value, and
 *   pressing it reports the flip; a locked cell is the value's text, with no control and no mark.
 */
import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PluginConfigEntry, PluginConfigField } from "@prismshadow/penguin-server/api";
import { ConfigHeading } from "../src/features/settings/plugin-config-heading";
import { ConfigTable } from "../src/features/settings/plugin-config-table";
import { PinToggle } from "../src/features/settings/plugin-config-table-cells";

const TABLE: PluginConfigField = {
  type: "table",
  title: "Presets",
  columns: [{ name: "name", type: "string", title: "Name" }],
  rows: [
    { id: "a", values: { name: "Full Access" } },
    { id: "b", values: { name: "Read Only" } },
  ],
};

const ENTRY: PluginConfigEntry = {
  name: "sandbox",
  configuration: { title: "Sandbox", properties: { presets: TABLE } },
  values: {},
  notices: [
    { tone: "attention", text: "No usable backend", onlyWhen: "enabled" },
    { tone: "muted", text: "Backends: none" },
  ],
};

const heading = (draft: Record<string, unknown>) =>
  renderToStaticMarkup(
    createElement(ConfigHeading, {
      entry: ENTRY,
      draft,
      nested: false,
      disabled: false,
      onAction: () => {},
      locale: "en",
    }),
  );

describe("the settings card", () => {
  it("shows a switch's notice only while the drafted switch is on", () => {
    expect(heading({ enabled: false })).not.toContain("No usable backend");
    expect(heading({ enabled: true })).toContain("No usable backend");
    expect(heading({ enabled: false })).toContain("Backends: none");
  });

  it("holds the effective name in the name box, the declared one when not renamed", () => {
    const html = renderToStaticMarkup(
      createElement(ConfigTable, {
        entry: ENTRY,
        name: "presets",
        field: TABLE,
        table: {
          rows: { a: { name: "" }, b: { name: "Look only" } },
          added: {},
          order: ["a", "b"],
        },
        onChange: () => {},
        errors: [],
        disabled: false,
        locale: "en",
      }),
    );
    // A wrapping box: a <textarea>, whose value renders as its content.
    const boxes = html.match(/<textarea[^>]*>[^<]*<\/textarea>/g) ?? [];
    const box = (row: string) => boxes.find((b) => b.includes(`aria-label="${row} · Name"`));
    expect(box("Full Access")).toMatch(/>Full Access<\/textarea>$/);
    // A row is named by its effective name, a renamed one by its new name: so is its name box.
    expect(box("Look only")).toMatch(/>Look only<\/textarea>$/);
    expect(box("Look only")).toContain('rows="1"');
    expect(box("Read Only")).toBeUndefined();
    expect(html).not.toContain("placeholder=");
  });

  it('puts every description behind a "?" beside its title, never on screen', () => {
    const html = renderToStaticMarkup(
      createElement(ConfigHeading, {
        entry: { ...ENTRY, configuration: { ...ENTRY.configuration, description: "Card meaning" } },
        draft: {},
        nested: false,
        disabled: false,
        onAction: () => {},
        locale: "en",
      }),
    );
    expect(html).toContain('aria-label="More info: Sandbox"');
    expect(html).not.toContain("Card meaning");
    const table = renderTable(PRESETS);
    for (const title of ["Presets", "Name", "Files", "Default", "Pin"]) {
      expect(table).toContain(`aria-label="More info: ${title}"`);
    }
    for (const text of [
      "Table meaning",
      "Name meaning",
      "Files meaning",
      "Default meaning",
      "Pin meaning",
    ]) {
      expect(table).not.toContain(text);
    }
  });

  it("draws a pin column as a pressed or unpressed toggle, and reports the flip", () => {
    const flips: Array<[string, string, unknown]> = [];
    const html = renderTable(PRESETS);
    const pin = (row: string) =>
      (html.match(/<button[^>]*aria-label="[^"]* · Pin"[^>]*>/g) ?? []).find((b) =>
        b.includes(`aria-label="${row} · Pin"`),
      );
    expect(pin("Full Access")).toContain('aria-pressed="true"');
    expect(pin("Read Only")).toContain('aria-pressed="false"');
    // Pressing it: the icon toggle it renders reports the flip.
    const toggle = PinToggle({
      label: "Read Only · Pin",
      pinned: false,
      tooltip: "Not in the menu",
      disabled: false,
      onChange: (on) => flips.push(["b", "enabled", on]),
    }) as ReactElement<{ onPress: () => void }>;
    toggle.props.onPress();
    expect(flips).toEqual([["b", "enabled", true]]);
  });

  it("draws a locked cell as its value alone, with no control and no mark", () => {
    const html = renderTable(PRESETS);
    const at = html.indexOf('aria-label="Full Access · Files: Off (');
    expect(at).toBeGreaterThan(-1);
    const cell = html.slice(at, html.indexOf("</td>", at));
    expect(cell).toContain(">Off<");
    expect(cell).toContain("data-tooltip=");
    expect(cell).not.toContain("<svg");
    expect(cell).not.toContain("<button");
  });
});

/** A presets-like table: a name, a locked enum, a row choice before a pin column. */
const PRESETS: PluginConfigField = {
  type: "table",
  title: "Presets",
  description: "Table meaning",
  rowChoice: { field: "pick", title: "Default", description: "Default meaning", before: "enabled" },
  columns: [
    { name: "name", type: "string", title: "Name", description: "Name meaning" },
    {
      name: "mode",
      type: "enum",
      title: "Files",
      description: "Files meaning",
      options: [
        { value: "off", title: "Off" },
        { value: "ro", title: "Read-only" },
      ],
    },
    {
      name: "enabled",
      type: "boolean",
      title: "Pin",
      description: "Pin meaning",
    },
  ],
  pin: { column: "enabled", on: "Pinned to the menu", off: "Not in the menu" },
  rows: [
    { id: "a", values: { name: "Full Access", mode: "off", enabled: true }, locked: ["mode"] },
    { id: "b", values: { name: "Read Only", mode: "ro", enabled: false } },
  ],
};

const tableElement = (field: PluginConfigField) =>
  createElement(ConfigTable, {
    entry: ENTRY,
    name: "presets",
    field,
    table: {
      rows: {
        a: { name: "", mode: "off", enabled: true },
        b: { name: "", mode: "ro", enabled: false },
      },
      added: {},
      order: ["a", "b"],
    },
    onChange: () => {},
    choice: "a",
    errors: [],
    disabled: false,
    locale: "en",
  });

const renderTable = (field: PluginConfigField) => renderToStaticMarkup(tableElement(field));
