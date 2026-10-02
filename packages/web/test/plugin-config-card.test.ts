/**
 * Two things the Sandbox card draws from its entry and draft.
 *
 * - Given a notice tied to a switch (`onlyWhen`), the heading shows it only while that field's
 *   draft is on; a notice tied to nothing always shows.
 * - Given a table row whose name was never changed, the name box holds the declared name as
 *   its value (normal ink, not a placeholder); a renamed row holds the new name.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PluginConfigEntry, PluginConfigField } from "@prismshadow/penguin-server/api";
import { ConfigHeading } from "../src/features/settings/plugin-config-heading";
import { ConfigTable } from "../src/features/settings/plugin-config-table";

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
        table: { a: { name: "" }, b: { name: "Look only" } },
        onCell: () => {},
        errors: [],
        disabled: false,
        locale: "en",
      }),
    );
    // A wrapping box: a <textarea>, whose value renders as its content.
    const boxes = html.match(/<textarea[^>]*>[^<]*<\/textarea>/g) ?? [];
    const box = (row: string) => boxes.find((b) => b.includes(`aria-label="${row} · Name"`));
    expect(box("Full Access")).toMatch(/>Full Access<\/textarea>$/);
    expect(box("Read Only")).toMatch(/>Look only<\/textarea>$/);
    expect(box("Read Only")).toContain('rows="1"');
    expect(html).not.toContain("placeholder=");
  });
});
