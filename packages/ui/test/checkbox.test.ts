/**
 * Checkbox (src/components/forms/checkbox/checkbox.tsx): a native checkbox drawn in tokens, whose
 * label toggles it and whose hint describes it, with a drawn dash for the indeterminate state.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Checkbox } from "../src/components/forms/checkbox/checkbox";
import { classTokens, renderStatic } from "../src/testing";

const noop = () => {};
const box = (props: Partial<Parameters<typeof Checkbox>[0]> = {}) =>
  renderStatic(createElement(Checkbox, { checked: false, onChange: noop, ...props }));

describe("Checkbox", () => {
  it("is a real checkbox, named by the caller when it has no label", () => {
    const html = box({ "aria-label": "Clear the stored key" });
    expect(html).toMatch(/<input type="checkbox"[^>]*aria-label="Clear the stored key"/);
    expect(html).not.toContain("<label");
    expect(html).not.toContain("<svg");
  });

  it("fills with the accent and draws the check only while on", () => {
    const off = classTokens(box());
    expect(off).toEqual(expect.arrayContaining(["border-line-emphasis", "bg-surface"]));
    const on = box({ checked: true });
    expect(on).toContain('checked=""');
    expect(classTokens(on)).toEqual(
      expect.arrayContaining(["border-accent", "bg-accent", "text-accent-fg"]),
    );
    expect(on).toContain('d="M2.6 6.2l2.2 2.2 4.6-4.8"');
  });

  it("draws a dash, not a check, for the indeterminate state", () => {
    const html = box({ indeterminate: true });
    expect(html).toContain('d="M3 6h6"');
    expect(html).not.toContain('d="M2.6 6.2');
    expect(classTokens(html)).toContain("bg-accent");
    // Mixed wins over checked: a summary box is never both.
    expect(box({ indeterminate: true, checked: true })).toContain('d="M3 6h6"');
  });

  it("wraps the box and its text in one label, and describes the box with its hint", () => {
    const html = box({ label: "Enabled", hint: "Runs on schedule" });
    expect(html.startsWith("<label")).toBe(true);
    const described = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(described).toBeDefined();
    expect(html).toContain(`id="${described}"`);
    expect(html).toContain("Runs on schedule");
    expect(classTokens(html)).toEqual(expect.arrayContaining(["text-xs", "text-fg-muted"]));
  });

  it("keeps a caller's own description beside the hint", () => {
    const html = box({ label: "Enabled", hint: "h", "aria-describedby": "outside" });
    expect(html).toMatch(/aria-describedby="outside [^"]+"/);
  });

  it("dims the whole row and refuses the pointer when disabled", () => {
    const html = box({ label: "Enabled", disabled: true });
    expect(html).toContain('disabled=""');
    expect(classTokens(html)).toEqual(expect.arrayContaining(["opacity-60", "cursor-not-allowed"]));
    expect(classTokens(box({ label: "Enabled" }))).toContain("cursor-pointer");
  });
});
