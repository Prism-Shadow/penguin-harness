/**
 * KeyValue: a two-column description list whose figures are tabular (rule 15 reads the
 * component), labels in the muted ink, identifier values in the data face.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { KeyValue, KeyValueRow } from "../src/components/data/key-value/key-value";
import { classTokens, renderStatic } from "../src/testing";

describe("KeyValue", () => {
  const html = renderStatic(
    createElement(
      KeyValue,
      null,
      createElement(KeyValueRow, { label: "Version" }, "0.2.13"),
      createElement(KeyValueRow, { label: "Root", mono: true }, "~/.penguin/data"),
    ),
  );

  it("is a two-column dl with tabular figures", () => {
    expect(html).toMatch(
      /^<dl class="grid grid-cols-\[auto_minmax\(0,1fr\)\] gap-x-4 tabular-nums /,
    );
    expect(html).toMatch(/<dt class="text-fg-muted">Version<\/dt><dd class="[^"]*">0\.2\.13<\/dd>/);
  });

  it("sets an identifier in the data face, and breaks any value rather than widen", () => {
    const values = [...html.matchAll(/<dd class="([^"]*)"/g)].map((m) => m[1]!.split(/\s+/));
    expect(values[0]).not.toContain("font-mono");
    expect(values[1]).toContain("font-mono");
    for (const value of values) expect(value).toContain("[overflow-wrap:anywhere]");
  });

  it("takes the body rung in a dialog", () => {
    expect(classTokens(renderStatic(createElement(KeyValue, { size: "sm" })))).toContain("text-sm");
  });
});
