/**
 * What the Sandbox card draws from its entry and draft: the switch alone while off, a notice's
 * details folded under it, the table's name boxes, "?"s, "(Default)" mark, row menus, pin
 * toggles and locked cells.
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

const ENTRY: PluginConfigEntry = {
  name: "sandbox",
  configuration: {
    title: "Sandbox",
    switch: "enabled",
    properties: {
      enabled: { type: "boolean", title: "Enable" },
      presets: { type: "table", title: "Presets", rowChoice: { field: "pick", title: "Default" } },
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

const heading = (draft: Record<string, unknown>, entry = ENTRY, locale: "en" | "zh" = "en") =>
  renderToStaticMarkup(
    createElement(ConfigHeading, {
      entry,
      draft,
      nested: false,
      disabled: false,
      onAction: () => {},
      locale,
    }),
  );

describe("the settings card", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));

  it("draws the switch alone while it is off, and everything else once it is on", () => {
    const names = (draft: Record<string, unknown>) => drawnFields(ENTRY, draft).map(([n]) => n);
    expect(names({})).toEqual(["enabled"]);
    // The row choice's field is drawn only as the table's marker.
    expect(names({ enabled: true })).toEqual(["enabled", "presets", "masks"]);
    for (const text of ["No usable backend", "Backends: none", "Set up"]) {
      expect(heading({ enabled: false })).not.toContain(text);
      expect(heading({ enabled: true })).toContain(text);
    }
    expect(heading({ enabled: false })).toContain("Sandbox");
  });

  it("folds a notice's details under it, collapsed, in the page's language", () => {
    const notice = { tone: "muted" as const, text: "Enforced here: file writes." };
    const withDetails = (locale: "en" | "zh") =>
      heading(
        { enabled: true },
        { ...ENTRY, notices: [{ ...notice, details: "bwrap refused", detailsZh: "bwrap 已拒绝" }] },
        locale,
      );
    const html = withDetails("en");
    // A collapsed button controlling the hidden panel that holds the details.
    const control = /aria-expanded="false" aria-controls="([^"]+)"/.exec(html)?.[1];
    expect(html.slice(html.indexOf(`id="${control}"`))).toMatch(
      /^id="[^"]+" hidden=""[^]*bwrap refused/,
    );
    expect(withDetails("zh")).toContain("bwrap 已拒绝");
    expect(heading({ enabled: true }, { ...ENTRY, notices: [notice] })).not.toContain(
      "aria-expanded",
    );
  });

  it("holds the effective name in the name box, the declared one when not renamed", () => {
    const html = renderTable(PRESETS, { b: { name: "Look only", mode: "ro", enabled: false } });
    // A wrapping box: a <textarea>, whose value renders as its content.
    const box = (row: string) =>
      new RegExp(`<textarea[^>]*aria-label="${row} · Name"[^>]*>([^<]*)<`).exec(html) ?? [];
    expect(box("Full Access")[1]).toBe("Full Access");
    expect(box("Look only")[1]).toBe("Look only");
    expect(box("Look only")[0]).toContain('rows="1"');
    expect(box("Read Only")[0]).toBeUndefined();
    expect(html).not.toContain("placeholder=");
  });

  it('puts every description behind a "?" beside its title, never on screen', () => {
    const configuration = { ...ENTRY.configuration, description: "Card meaning" };
    const html = heading({}, { ...ENTRY, configuration }) + renderTable(PRESETS);
    for (const title of ["Sandbox", "Presets", "Name", "Files", "Pin"]) {
      expect(html).toContain(`aria-label="More info: ${title}"`);
    }
    expect(html).not.toMatch(/(Card|Table|Name|Files|Pin) meaning/);
  });

  it('marks the chosen row "(Default)" after its name, with no Default column or star', () => {
    const html = renderTable(PRESETS);
    expect(html.match(/\(Default\)/g)).toHaveLength(1);
    const at = html.indexOf('aria-label="Full Access · Name"');
    expect(html.indexOf("(Default)", at)).toBeLessThan(html.indexOf("Read Only", at));
    expect(html).not.toContain(">Default<");
    expect(html).not.toContain('data-tooltip="Already');
    // In Chinese, with the title's Chinese and full-width brackets.
    setActiveStrings(zh);
    try {
      const rowChoice = { field: "pick", title: "Default", titleZh: "默认" };
      expect(renderTable({ ...PRESETS, rowChoice }, {}, "zh")).toContain("（默认）");
    } finally {
      setActiveStrings(en);
    }
  });

  it('gives every row a "?" saying what the row is for', () => {
    expect(renderTable(PRESETS)).toContain('aria-label="More info: Read Only"');
    const cols = PRESETS.columns!;
    const row = (mode: string) => ({
      id: "b",
      declared: PRESETS.rows![1]!,
      cells: { name: "", mode, enabled: false },
    });
    const same = (text: string) => text;
    // A declared row keeping its choices: its own text; otherwise a line per choice.
    expect(rowHelp(cols, row("ro"), same)).toBe("For looking around");
    expect(rowHelp(cols, row("off"), same)).toEqual(["Files: Off. Writes anywhere."]);
    expect(rowHelp([cols[1]!], { id: "x", cells: { mode: "ro" } }, same)).toEqual([
      "Files: Read-only",
    ]);
  });

  it('gives every row a "…" menu button that announces a menu', () => {
    const html = renderTable(PRESETS);
    const button = /<button[^>]*aria-label="More actions: Read Only"[^>]*>/.exec(html)?.[0];
    expect(button).toContain('aria-haspopup="menu"');
    expect(button).toContain('type="button"');
    expect(button).not.toContain("tabindex");
  });

  it("offers Set as default on every row and Delete on an added row, both run", () => {
    const ran: string[] = [];
    const actions = (chosen: boolean, added: boolean, canChoose = true) =>
      rowActions({
        chosen,
        canChoose,
        added,
        onChoose: () => ran.push("choose"),
        onDelete: () => ran.push("delete"),
      });
    expect(actions(false, false).map((a) => a.id)).toEqual(["choose"]);
    expect(actions(false, false, false)).toEqual([]);
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
  });

  it("draws a pin column as a pressed or unpressed toggle, and reports the flip", () => {
    const html = renderTable(PRESETS);
    const pin = (row: string) =>
      new RegExp(`<button[^>]*aria-label="${row} · Pin"[^>]*>`).exec(html)?.[0];
    expect(pin("Full Access")).toContain('aria-pressed="true"');
    expect(pin("Read Only")).toContain('aria-pressed="false"');
    const flips: boolean[] = [];
    const toggle = PinToggle({
      label: "Read Only · Pin",
      pinned: false,
      tooltip: "Not in the menu",
      disabled: false,
      onChange: (on) => flips.push(on),
    }) as ReactElement<{ onPress: () => void }>;
    toggle.props.onPress();
    expect(flips).toEqual([true]);
  });

  it("draws a locked cell as its value alone, with no control and no mark", () => {
    const html = renderTable(PRESETS);
    const at = html.indexOf(`data-tooltip="${en.settings.pluginCellLocked}"`);
    const cell = html.slice(at, html.indexOf("</td>", at));
    // Announced as it reads, "locked" in visually hidden text after it.
    expect(cell).toContain(`>Off<span class="sr-only"> (${en.settings.pluginCellLocked})</span>`);
    expect(cell).not.toMatch(/aria-hidden|aria-label|<svg|<button/);
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
    { name: "enabled", type: "boolean", title: "Pin", description: "Pin meaning" },
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

const renderTable = (
  field: PluginConfigField,
  rows: Record<string, Record<string, unknown>> = {},
  locale: "en" | "zh" = "en",
) =>
  renderToStaticMarkup(
    createElement(ConfigTable, {
      entry: ENTRY,
      name: "presets",
      field,
      table: {
        rows: {
          a: { name: "", mode: "off", enabled: true },
          b: { name: "", mode: "ro", enabled: false },
          ...rows,
        },
        added: {},
        order: ["a", "b"],
      },
      onChange: () => {},
      choice: "a",
      errors: [],
      disabled: false,
      locale,
    }),
  );
