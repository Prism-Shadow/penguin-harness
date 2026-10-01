/**
 * CreateButtons (src/components/actions/create-buttons/create-buttons.tsx): the AI path in the
 * accent and the manual path beside it, both in the caller's words; the manual one only where the
 * surface offers it, and greyed alone when its form cannot open.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { CreateButtons } from "../src/components/actions/create-buttons/create-buttons";
import { renderStatic } from "../src/testing";

const noop = () => {};

describe("CreateButtons", () => {
  it("draws both paths in the caller's words, the AI one first", () => {
    const html = renderStatic(
      createElement(CreateButtons, {
        onAi: noop,
        aiLabel: "Create with AI",
        onManual: noop,
        manualLabel: "Create manually",
        manualDisabled: true,
      }),
    );
    expect(html.indexOf("Create with AI")).toBeLessThan(html.indexOf("Create manually"));
    expect(html.match(/disabled=""/g)).toHaveLength(1);
  });

  it("offers the AI path alone where the manual one is absent", () => {
    const html = renderStatic(
      createElement(CreateButtons, { onAi: noop, aiLabel: "Import with AI" }),
    );
    expect(html.match(/<button/g)).toHaveLength(1);
  });
});
