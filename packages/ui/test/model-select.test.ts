/**
 * The model picker's trigger (src/components/chat/model-select/model-select.tsx): the composer's
 * pill or a dialog's form field, named and hinted by the caller, announcing the dialog it opens
 * and whether that is open; no logo where no provider is named.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ModelSelect } from "../src/components/chat/model-select/model-select";
import { classTokens, renderStatic } from "../src/testing";

describe("ModelSelect", () => {
  const trigger = (
    variant: "pill" | "form",
    provider: string | null = "openai",
    expanded = false,
  ) =>
    renderStatic(
      createElement(ModelSelect, {
        label: "GPT",
        provider,
        ariaLabel: "Choose model",
        tooltip: "Choose model: GPT",
        variant,
        expanded,
        onClick: () => {},
      }),
    );

  it("is the toolbar pill: the logo, the name hidden on a narrow card, the caret", () => {
    const html = trigger("pill");
    expect(html).toContain('aria-label="Choose model"');
    expect(html).toContain('data-tooltip="Choose model: GPT"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(">GPT</span>");
    expect(classTokens(html)).toEqual(expect.arrayContaining(["@md:block", "max-w-44"]));
    expect(trigger("pill", "openai", true)).toContain('aria-expanded="true"');
  });

  it("is a dialog's form field, and draws no logo where no provider is named", () => {
    const named = trigger("form");
    expect(named).toContain('aria-label="Choose model"');
    expect(named).toContain('aria-haspopup="dialog"');
    expect(classTokens(named)).toContain("w-full");
    const svgs = (html: string) => html.match(/<svg/g)?.length ?? 0;
    expect(svgs(trigger("form", null))).toBe(svgs(named) - 1);
  });
});
