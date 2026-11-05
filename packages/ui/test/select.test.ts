/**
 * Select (src/components/forms/select/select.tsx): a custom-drawn trigger that keeps the native
 * select's API — `<option>` children, `onChange(e.target.value)` — and names itself like one. The
 * list is portaled and mounted only while open, so what renders statically is the trigger.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Select } from "../src/components/forms/select/select";
import { classTokens, renderStatic } from "../src/testing";

const options = [
  createElement("option", { key: "a", value: "a" }, "Alpha"),
  createElement("option", { key: "b", value: "b" }, "Beta"),
];

describe("Select", () => {
  it("is a listbox trigger showing the chosen option, or the first while none matches", () => {
    const html = renderStatic(createElement(Select, { value: "b", onChange: () => {} }, options));
    expect(html).toMatch(/^<button type="button" aria-haspopup="listbox" aria-expanded="false"/);
    expect(html).toContain(">Beta</span>");
    expect(html).not.toContain('role="listbox"');
    const unmatched = renderStatic(createElement(Select, { value: "z" }, options));
    expect(unmatched).toContain(">Alpha</span>");
  });

  it("forwards its accessible name and its required and invalid states", () => {
    const html = renderStatic(
      createElement(
        Select,
        { value: "a", "aria-label": "Model", required: true, error: "Pick one" },
        options,
      ),
    );
    expect(html).toContain('aria-label="Model"');
    expect(html).toContain('aria-required="true"');
    expect(html).toContain('aria-invalid="true"');
    const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(describedBy).toBeDefined();
    expect(html).toContain(`id="${describedBy}" role="alert"`);
    expect(html).toContain("Pick one");
  });

  it("draws its caret in the subtle ink", () => {
    expect(classTokens(renderStatic(createElement(Select, { value: "a" }, options)))).toContain(
      "text-fg-subtle",
    );
  });
});
