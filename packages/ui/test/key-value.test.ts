/**
 * KeyValue: a two-column description list whose figures are tabular (rule 15 reads the
 * component), labels in the muted ink, identifier values in the data face.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { KeyValue, KeyValueRow } from "../src/components/data/key-value/key-value";
import { renderStatic } from "../src/testing";

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
    expect(html).toMatch(/^<dl /);
    expect(html).toMatch(/<dt class="[^"]*">Version<\/dt><dd class="[^"]*">0\.2\.13<\/dd>/);
  });
});
