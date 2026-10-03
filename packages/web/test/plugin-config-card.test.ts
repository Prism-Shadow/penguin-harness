/**
 * What the Sandbox card draws from its entry and draft.
 *
 * - Given a group with a `switch`, while the switch is off as drafted the card draws that field
 *   alone (no table, no Advanced field, no row-choice field) and the heading no notice or
 *   action; on, it draws them all but the field a row choice stores into.
 * - Given a table row whose name was never changed, the name box holds the declared name as
 *   its value (normal ink, not a placeholder); a renamed row holds the new name.
 * - Given described columns and a described group, every header and the card title carry a "?"
 *   and no description is a paragraph on screen.
 * - Given a pin column, each cell is a toggle button whose pressed state is the row's value, and
 *   pressing it reports the flip; a locked cell is the value's text, with no control and no mark.
 * - Given a row choice, the chosen row's name is followed by "(Default)" and no other's is; there
 *   is no Default column and no star.
 * - Every row's name has a "?" named after the row: a declared row's text while its choices are
 *   the declared ones, otherwise a line per choice with its value and what that option does.
 * - Every row has a "…" menu button (a real button, so Tab reaches it, announcing a menu): Set as
 *   default on every row, Delete only on an added row; on the chosen row both are disabled,
 *   saying why; running them picks the row and deletes it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PluginConfigEntry, PluginConfigField } from "@prismshadow/penguin-server/api";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { drawnFields } from "../src/features/settings/plugin-config-draft";
import { rowHelp } from "../src/features/settings/plugin-config-field-cell";
import { ConfigHeading } from "../src/features/settings/plugin-config-heading";
import { rowActions } from "../src/features/settings/plugin-config-row-menu";
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
  configuration: {
    title: "Sandbox",
    switch: "enabled",
    properties: {
      enabled: { type: "boolean", title: "Enable" },
      presets: { ...TABLE, rowChoice: { field: "pick", title: "Default" } },
      pick: { type: "enum", title: "Default", options: [{ value: "a", title: "A" }] },
      masks: { type: "list", title: "Masked paths", advanced: true },
    },
  },
  values: {},
  notices: [
    { tone: "attention", text: "No usable backend" },
    { tone: "muted", text: "Backends: none" },
  ],
  actions: [{ id: "setup", title: "Set up" }],
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
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));

  it("draws the switch alone while it is off, and everything else once it is on", () => {
    const names = (draft: Record<string, unknown>) => drawnFields(ENTRY, draft).map(([n]) => n);
    expect(names({ enabled: false })).toEqual(["enabled"]);
    expect(names({})).toEqual(["enabled"]);
    // The row choice's field is drawn only as the table's marker.
    expect(names({ enabled: true })).toEqual(["enabled", "presets", "masks"]);
    for (const text of ["No usable backend", "Backends: none", "Set up"]) {
      expect(heading({ enabled: false })).not.toContain(text);
      expect(heading({ enabled: true })).toContain(text);
    }
    // The title and its "?" stay either way.
    expect(heading({ enabled: false })).toContain("Sandbox");
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
    for (const title of ["Presets", "Name", "Files", "Pin"]) {
      expect(table).toContain(`aria-label="More info: ${title}"`);
    }
    for (const text of ["Table meaning", "Name meaning", "Files meaning", "Pin meaning"]) {
      expect(table).not.toContain(text);
    }
  });

  it('marks the chosen row "(Default)" after its name, with no Default column or star', () => {
    const html = renderTable(PRESETS);
    expect(html.match(/\(Default\)/g)).toHaveLength(1);
    // Right after the chosen row's name box, before the next row starts.
    const at = html.indexOf('aria-label="Full Access · Name"');
    expect(html.indexOf("(Default)", at)).toBeLessThan(html.indexOf("Read Only", at));
    expect(html).not.toContain(">Default<");
    expect(html).not.toContain('aria-pressed="true" data-tooltip="Already');
    // In Chinese, with the title's Chinese and full-width brackets.
    setActiveStrings(zh);
    try {
      const zhHtml = renderToStaticMarkup(
        createElement(ConfigTable, {
          ...tableElement(PRESETS).props,
          field: { ...PRESETS, rowChoice: { field: "pick", title: "Default", titleZh: "默认" } },
          locale: "zh",
        }),
      );
      expect(zhHtml).toContain("（默认）");
    } finally {
      setActiveStrings(en);
    }
  });

  it('gives every row a "?" after its name, saying what the row is for', () => {
    const html = renderTable(PRESETS);
    for (const row of ["Full Access", "Read Only"]) {
      expect(html).toContain(`aria-label="More info: ${row}"`);
    }
    const localized = (en: string) => en;
    const files = PRESETS.columns![1]!;
    const declared = PRESETS.rows![1]!;
    const drawn = (mode: string) => ({
      id: "b",
      declared,
      cells: { name: "", mode, enabled: false },
    });
    // A declared row keeping its choices: its own text.
    expect(rowHelp(PRESETS.columns!, drawn("ro"), localized)).toBe("For looking around");
    // Its choices changed, or a row with no text of its own: a line per choice, with what it does.
    expect(rowHelp(PRESETS.columns!, drawn("off"), localized)).toEqual([
      "Files: Off. Writes anywhere.",
    ]);
    expect(rowHelp([files], { id: "x", cells: { mode: "ro" } }, localized)).toEqual([
      "Files: Read-only",
    ]);
  });

  it('gives every row a "…" menu button that announces a menu', () => {
    const html = renderTable(PRESETS);
    for (const row of ["Full Access", "Read Only"]) {
      const button = html.match(
        new RegExp(`<button[^>]*aria-label="More actions: ${row}"[^>]*>`),
      )?.[0];
      expect(button).toContain('aria-haspopup="menu"');
      expect(button).toContain('type="button"');
      expect(button).not.toContain("tabindex");
    }
    // No star toggle and no trash button left in the row.
    expect(html).not.toContain("Delete ");
  });

  it("offers Set as default on every row and Delete on an added row, both run", () => {
    const ran: string[] = [];
    const actions = (chosen: boolean, added: boolean) =>
      rowActions({
        chosen,
        canChoose: true,
        added,
        onChoose: () => ran.push("choose"),
        onDelete: () => ran.push("delete"),
      });
    expect(actions(false, false).map((a) => a.id)).toEqual(["choose"]);
    const added = actions(false, true);
    expect(added.map((a) => [a.id, a.label, a.blocked])).toEqual([
      ["choose", "Set as default", undefined],
      ["delete", "Delete", undefined],
    ]);
    for (const a of added) a.run();
    expect(ran).toEqual(["choose", "delete"]);
    // The chosen row is already the default, and cannot be deleted until another row is.
    expect(actions(true, true).map((a) => a.blocked)).toEqual([
      "Already the default",
      "Set another row as default first",
    ]);
    expect(
      rowActions({
        chosen: false,
        canChoose: false,
        added: false,
        onChoose: () => {},
        onDelete: () => {},
      }),
    ).toEqual([]);
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
  rowChoice: { field: "pick", title: "Default" },
  columns: [
    { name: "name", type: "string", title: "Name", description: "Name meaning" },
    {
      name: "mode",
      type: "enum",
      title: "Files",
      description: "Files meaning",
      options: [
        { value: "off", title: "Off", description: "Writes anywhere." },
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
    {
      id: "b",
      values: { name: "Read Only", mode: "ro", enabled: false },
      description: "For looking around",
    },
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
