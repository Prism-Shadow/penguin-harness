/**
 * The text controls (src/components/forms/input/input.tsx): the size rungs, the error state, the
 * autofill opt-out, the hover hint and the in-field affixes.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  Input,
  Textarea,
  autofillProps,
  errorClass,
  noAutofill,
  sizeClass,
  sizeTextClass,
} from "../src/components/forms/input/input";
import { classTokens, renderStatic } from "../src/testing";

const IGNORES = {
  "data-1p-ignore": "",
  "data-lpignore": "true",
  "data-bwignore": "",
  "data-form-type": "other",
};

const input = (props: Parameters<typeof Input>[0]) =>
  renderStatic(createElement(Input, { value: "", readOnly: true, ...props }));

describe("the size rungs", () => {
  it("spell a control's font size in one record, sm by default", () => {
    expect(sizeTextClass).toEqual({ base: "text-base", sm: "text-xs" });
    expect(sizeClass.sm).toBe("px-2 py-1 text-xs");
    expect(sizeClass.base).toBe("px-3 py-2 text-base");
    const tokens = classTokens(input({}));
    expect(tokens).toEqual(expect.arrayContaining(["px-2", "py-1", "text-xs", "w-full"]));
    expect(tokens).not.toContain("text-base");
  });
});

describe("Input", () => {
  it("marks a required field for assistive tech without the browser's own validation", () => {
    const html = input({ label: "Name", required: true });
    expect(html).toContain('aria-required="true"');
    expect(html).not.toMatch(/<input[^>]* required/);
  });

  it("ties the error text to the control and marks it invalid", () => {
    const html = input({ label: "Name", error: "Required" });
    const described = /aria-describedby="([^"]+)"/.exec(html);
    expect(described).not.toBeNull();
    expect(html).toContain(`id="${described?.[1]}" role="alert"`);
    expect(html).toContain('aria-invalid="true"');
  });

  it("can be marked invalid with the error text placed elsewhere", () => {
    const html = input({ invalid: true });
    expect(html).toContain('aria-invalid="true"');
    expect(html).not.toContain("aria-describedby");
    expect(classTokens(html)).toContain("!border-tone-danger-fg");
  });

  it("marks an error with the danger line alone, never a tinted box inside it", () => {
    const tokens = errorClass.split(/\s+/);
    expect(tokens).toContain("!border-tone-danger-fg");
    expect(tokens.some((t) => t.includes("tone-danger-bg"))).toBe(false);
  });

  it("shows its hover hint in the shared tooltip, never the browser's title", () => {
    const html = input({ title: "Milliseconds" });
    expect(html).toContain('data-tooltip="Milliseconds"');
    expect(html).not.toContain("title=");
  });

  it("opts out of autofill unless the caller declares a credential role", () => {
    const html = input({});
    expect(html).toMatch(/autocomplete="off"/i);
    expect(html).toContain("data-1p-ignore");
    expect(input({ type: "password" })).toMatch(/autocomplete="new-password"/i);
    expect(input({ autoComplete: "username" })).not.toContain("data-1p-ignore");
  });

  it("draws its affixes inside the box, clear of the pointer, and pads the value past them", () => {
    const html = input({ affix: { leading: "¥", trailing: "/M tok" } });
    expect(html).toMatch(
      /^<span class="relative block"><span class="[^"]*left-2[^"]*">¥<\/span><input/,
    );
    expect(html).toMatch(
      /<\/span><input[^>]*\/><span class="[^"]*right-2[^"]*">\/M tok<\/span><\/span>$/,
    );
    expect(classTokens(html)).toEqual(
      expect.arrayContaining(["pointer-events-none", "absolute", "text-fg-subtle"]),
    );
    // Unmeasured, the padding still clears the affix's inset: never less than the control's own.
    expect(html).toContain("padding-left:calc(0px + 0.75rem)");
    expect(html).toContain("padding-right:calc(0px + 0.75rem)");
  });

  it("reserves only the side an affix takes, and keeps its error below the box", () => {
    const html = input({ label: "Context", error: "Too large", affix: { trailing: "Token" } });
    expect(html).toContain("padding-right:calc(0px + 0.75rem)");
    expect(html).not.toContain("padding-left");
    expect(html).toMatch(/<\/span><span id="[^"]+" role="alert"/);
  });
});

describe("Textarea", () => {
  it("keeps the roomier padding at both rungs, with the extra leading at sm", () => {
    const html = renderStatic(createElement(Textarea, { value: "", readOnly: true, mono: true }));
    expect(classTokens(html)).toEqual(
      expect.arrayContaining(["px-3", "py-2", "text-xs", "leading-relaxed", "font-mono"]),
    );
    const base = renderStatic(createElement(Textarea, { value: "", readOnly: true, size: "base" }));
    expect(classTokens(base)).toContain("text-base");
    expect(classTokens(base)).not.toContain("leading-relaxed");
  });
});

describe("autofillProps", () => {
  it("opts an undeclared field out, and a secret one as new-password", () => {
    expect(autofillProps(undefined, false)).toEqual({ autoComplete: "off", ...IGNORES });
    expect(autofillProps("off", true)).toEqual({ autoComplete: "new-password", ...IGNORES });
    expect(noAutofill).toEqual(autofillProps(undefined, false));
  });
});
