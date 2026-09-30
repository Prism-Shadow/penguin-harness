/**
 * The chips with remove buttons (src/components/forms/tag-input/tag-input.tsx): a chip names what
 * it stands for and takes itself back with a × the caller names; its label gives way while a
 * suffix stays whole; a chip holding a control keeps its tooltip off the control; the two weights
 * space their rows apart.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Chip, TagInput } from "../src/components/forms/tag-input/tag-input";
import { classTokens, renderStatic } from "../src/testing";

describe("Chip", () => {
  it("names its remove button with the caller's words, and has none without them", () => {
    const removable = renderStatic(
      createElement(Chip, { label: "notes.md", removeLabel: "Remove notes.md" }),
    );
    expect(removable).toContain('aria-label="Remove notes.md"');
    expect(removable).toContain(">×</button>");
    const fixed = renderStatic(createElement(Chip, { label: "notes.md" }));
    expect(fixed).not.toContain("<button");
  });

  it("truncates the label and keeps the suffix and the readout whole after it", () => {
    const html = renderStatic(
      createElement(Chip, {
        label: "server.ts",
        suffix: ":12-30",
        meta: "4 KB",
        tooltip: "src/server.ts:12-30",
        mono: true,
      }),
    );
    expect(html).toContain('data-tooltip="src/server.ts:12-30"');
    expect(html).toContain('<span class="min-w-0 truncate">server.ts</span>');
    expect(html).toContain('<span class="shrink-0">:12-30</span>');
    expect(html.indexOf("server.ts<")).toBeLessThan(
      html.indexOf('<span class="shrink-0">:12-30</span>'),
    );
    expect(classTokens(html)).toEqual(
      expect.arrayContaining(["font-mono", "bg-fill-neutral", "text-fg-subtle"]),
    );
  });

  it("with a control, names the label part alone and parts it from the control with a rule", () => {
    const html = renderStatic(
      createElement(Chip, {
        label: "Goal",
        tooltip: "Keep working until it is done",
        control: createElement("button", { type: "button" }, "Budget"),
      }),
    );
    const tooltip = html.indexOf('data-tooltip="Keep working until it is done"');
    expect(tooltip).toBeGreaterThan(html.indexOf("<span"));
    expect(html.startsWith("<span data-tooltip=")).toBe(false);
    expect(html).toContain('aria-hidden="true"');
    expect(html.indexOf("Goal")).toBeLessThan(html.indexOf("Budget"));
    expect(classTokens(html)).toContain("max-w-full");
  });
});

describe("TagInput", () => {
  const chips = [
    { key: "a", label: "alpha", removeLabel: "Remove alpha" },
    { key: "b", label: "beta" },
  ];

  it("draws each chip in order, between the caller's leading and trailing chips", () => {
    const html = renderStatic(
      createElement(TagInput, {
        chips,
        leading: createElement("i", null, "FIRST"),
        trailing: createElement("i", null, "LAST"),
      }),
    );
    const order = ["FIRST", "alpha", "beta", "LAST"].map((s) => html.indexOf(s));
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(html.match(/<button/g)).toHaveLength(1);
  });

  it("packs soft chips tight and spaces bordered ones wider", () => {
    const soft = classTokens(renderStatic(createElement(TagInput, { chips })));
    expect(soft).toEqual(expect.arrayContaining(["gap-1", "bg-fill-neutral"]));
    const outline = classTokens(
      renderStatic(createElement(TagInput, { chips, variant: "outline" })),
    );
    expect(outline).toEqual(expect.arrayContaining(["gap-2", "border", "border-line"]));
    expect(outline).not.toContain("bg-fill-neutral");
  });
});
