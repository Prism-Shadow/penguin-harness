/**
 * Checkbox (src/components/forms/checkbox/checkbox.tsx): a native checkbox drawn in tokens, whose
 * label toggles it and whose hint describes it, with a drawn dash for the indeterminate state;
 * and CheckboxBox, the same box as a drawing for a control that toggles like a checkbox.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Checkbox, CheckboxBox } from "../src/components/forms/checkbox/checkbox";
import { renderStatic } from "../src/testing";

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

  it("is checked and draws the check only while on", () => {
    const on = box({ checked: true });
    expect(on).toContain('checked=""');
    expect(on).toContain('d="M2.6 6.2l2.2 2.2 4.6-4.8"');
  });

  it("draws a dash, not a check, for the indeterminate state", () => {
    const html = box({ indeterminate: true });
    expect(html).toContain('d="M3 6h6"');
    expect(html).not.toContain('d="M2.6 6.2');
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
  });

  it("keeps a caller's own description beside the hint", () => {
    const html = box({ label: "Enabled", hint: "h", "aria-describedby": "outside" });
    expect(html).toMatch(/aria-describedby="outside [^"]+"/);
  });

  it("takes no input when disabled", () => {
    const html = box({ label: "Enabled", disabled: true });
    expect(html).toContain('disabled=""');
  });
});

describe("the box", () => {
  it("draws the box for a control that is not a checkbox, hidden, ticked only when on", () => {
    const off = renderStatic(createElement(CheckboxBox, { on: false }));
    expect(off).toMatch(/^<span aria-hidden="true" class="[^"]*"><\/span>$/);
    // No hover of its own: the control around it takes the hover.
    const on = renderStatic(createElement(CheckboxBox, { on: true }));
    expect(on).toContain('d="M2.6 6.2l2.2 2.2 4.6-4.8"');
  });
});
