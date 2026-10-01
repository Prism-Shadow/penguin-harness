/**
 * Radio and RadioGroup (src/components/forms/radio/radio.tsx): native radios drawn in tokens, in
 * a fieldset whose legend names the choice and whose radios share one name.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Radio, RadioGroup } from "../src/components/forms/radio/radio";
import { classTokens, renderStatic } from "../src/testing";

const noop = () => {};

const OPTIONS = [
  { value: "skip", label: "Skip", hint: "Keep what is there" },
  { value: "overwrite", label: "Overwrite", hint: "Replace matching names" },
  { value: "replace", label: "Replace", disabled: true },
] as const;

const group = (props: Partial<Parameters<typeof RadioGroup<string>>[0]> = {}) =>
  renderStatic(
    createElement(RadioGroup<string>, {
      label: "When a name exists",
      options: OPTIONS,
      value: "skip",
      onChange: noop,
      ...props,
    }),
  );

describe("RadioGroup", () => {
  it("is a fieldset named by its legend, in the field-label look", () => {
    const html = group();
    expect(html).toMatch(
      /^<fieldset class="[^"]*"><legend class="[^"]*">When a name exists<\/legend>/,
    );
    expect(classTokens(html)).toEqual(expect.arrayContaining(["font-semibold", "text-fg-muted"]));
  });

  it("gives every radio one shared name, and checks only the current value", () => {
    const html = group({ name: "import-mode" });
    expect(html.match(/<input type="radio"/g)).toHaveLength(3);
    expect(html.match(/name="import-mode"/g)).toHaveLength(3);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toMatch(/<input type="radio"[^>]*checked=""[^>]*value="skip"/);
  });

  it("describes each radio with its hint, and disables an option on its own", () => {
    const html = group();
    const described = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((m) => m[1]);
    expect(described).toHaveLength(2);
    for (const id of described) expect(html).toContain(`id="${id}"`);
    expect(html.match(/disabled=""/g)).toHaveLength(1);
  });

  it("lays the options out on one line when asked", () => {
    expect(classTokens(group())).toContain("flex-col");
    expect(classTokens(group({ orientation: "horizontal" }))).toContain("flex-wrap");
  });
});

describe("Radio", () => {
  it("fills with the accent and draws the inner disc only while selected", () => {
    const off = renderStatic(
      createElement(Radio, { checked: false, onChange: noop, "aria-label": "A" }),
    );
    expect(classTokens(off)).toEqual(
      expect.arrayContaining(["border-line-emphasis", "bg-surface"]),
    );
    expect(off).not.toContain("bg-accent-fg");
    const on = renderStatic(
      createElement(Radio, { checked: true, onChange: noop, "aria-label": "A" }),
    );
    expect(classTokens(on)).toEqual(
      expect.arrayContaining(["border-accent", "bg-accent", "bg-accent-fg", "rounded-full"]),
    );
  });
});
