/**
 * The field scaffolding (src/components/forms/field/field.tsx): the required mark, the label, hint
 * and error, the two layouts, and the control look in tokens.
 *
 * The layout trap is HTML's, not React's: an info trigger is a `<button>`, a `<button>` is a
 * labelable element, and a wrapping `<label>` names its FIRST labelable descendant. Nesting a
 * trigger inside `Field`'s usual `<label>` wrapper would therefore retarget the field's title from
 * the input to the "?" — silently, with no visual symptom.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  Field,
  FieldError,
  FieldHint,
  FieldLabel,
  RequiredMark,
  controlBase,
} from "../src/components/forms/field/field";
import { Input } from "../src/components/forms/input/input";
import { classTokens, renderStatic } from "../src/testing";

const control = createElement("input", { id: "c" });

describe("RequiredMark", () => {
  it("is decorative beside a control, whose aria-required is what gets announced", () => {
    const html = renderStatic(createElement(RequiredMark));
    expect(html).toBe('<span class="ml-0.5 text-tone-danger-fg" aria-hidden="true">*</span>');
  });

  it("states itself where no control carries aria-required", () => {
    const html = renderStatic(createElement(RequiredMark, { label: "required" }));
    expect(html).toMatch(
      /^<span class="[^"]*text-tone-danger-fg[^"]*"><span aria-hidden="true">\*<\/span>/,
    );
    expect(html).toContain('<span class="sr-only">required</span>');
  });
});

describe("FieldLabel, FieldHint and FieldError", () => {
  it("is a real label when it knows the control's id, and a span inside a wrapping label", () => {
    expect(renderStatic(createElement(FieldLabel, { htmlFor: "c", children: "Name" }))).toMatch(
      /^<label for="c" class="[^"]*text-fg-muted[^"]*">Name<\/label>$/,
    );
    const span = renderStatic(createElement(FieldLabel, { required: true, children: "Name" }));
    expect(span).toMatch(/^<span class="[^"]*mb-1 block[^"]*">Name<span/);
    expect(span).toContain('aria-hidden="true">*</span>');
  });

  it("drops the block layout when the label shares a row", () => {
    const html = renderStatic(createElement(FieldLabel, { block: false, children: "Name" }));
    expect(classTokens(html)).not.toContain("block");
  });

  it("announces an error the moment it appears, under the id the control points at", () => {
    const html = renderStatic(createElement(FieldError, { id: "e", children: "Required" }));
    expect(html).toContain('id="e"');
    expect(html).toContain('role="alert"');
    expect(classTokens(html)).toContain("text-tone-danger-fg");
    expect(classTokens(renderStatic(createElement(FieldHint, { children: "ms" })))).toContain(
      "text-fg-muted",
    );
  });
});

describe("Field", () => {
  it("renders the bare control when there is nothing to put around it", () => {
    expect(renderStatic(createElement(Field, { children: control }))).toBe('<input id="c"/>');
  });

  it("wraps the control in its label, and shows the error in place of the hint", () => {
    const plain = renderStatic(createElement(Field, { label: "Name", children: control }));
    expect(plain.startsWith("<label")).toBe(true);
    expect(plain).not.toContain("<label for=");
    const failed = renderStatic(
      createElement(Field, {
        label: "Name",
        hint: "Letters only",
        error: "Required",
        errorId: "e",
        children: control,
      }),
    );
    expect(failed).toContain('<span id="e" role="alert"');
    expect(failed).not.toContain("Letters only");
  });

  describe("with an info popover", () => {
    const withInfo = renderStatic(
      createElement(Input, {
        label: "Timeout",
        info: "Per-request timeout.",
        infoLabel: "Timeout",
        hint: "milliseconds",
        value: "",
        readOnly: true,
      }),
    );

    it("associates the title by htmlFor instead of wrapping the control", () => {
      const forMatch = /<label for="([^"]+)"/.exec(withInfo);
      expect(forMatch, "the title must be a <label for=…>").not.toBeNull();
      expect(withInfo).toContain(`id="${forMatch?.[1]}"`);
    });

    it("never puts the trigger inside a label element", () => {
      expect(withInfo).toContain("<button");
      // Everything between a <label> open tag and its close must be free of <button>.
      for (const [, inner] of withInfo.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)) {
        expect(inner).not.toContain("<button");
      }
    });

    it("names the trigger after the field", () => {
      expect(withInfo).toContain('aria-label="More info: Timeout"');
    });

    it("keeps a formatting hint visible alongside the disclosed semantics", () => {
      // The split is the whole point: what the field MEANS is disclosed, what shape the value
      // must take stays on screen while the user types.
      expect(withInfo).toContain("milliseconds");
      expect(withInfo).not.toContain("Per-request timeout.");
    });
  });
});

describe("controlBase", () => {
  it("draws the control in tokens, with the theme's own input focus ring", () => {
    expect(controlBase.split(/\s+/)).toEqual(
      expect.arrayContaining([
        "border-line-emphasis",
        "bg-surface",
        "text-fg",
        "hover:border-fg-subtle",
        "focus:border-fg-muted",
        "focus:[box-shadow:var(--ui-focus-ring-input)]",
      ]),
    );
  });
});
