/**
 * The menu panel (src/components/overlays/menu-panel/menu-panel.tsx): the panel, row states and
 * check mark every picker and menu shares, in tokens.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ChoiceCheck, menuRowTone } from "../src/components/overlays/menu-panel/menu-panel";
import { renderStatic } from "../src/testing";

describe("menu panel", () => {
  it("treats a row as not the current choice by default", () => {
    expect(menuRowTone()).toBe(menuRowTone(false));
  });

  it("keeps the check's slot whether or not the row is the current choice", () => {
    const on = renderStatic(createElement(ChoiceCheck, { on: true }));
    const off = renderStatic(createElement(ChoiceCheck, { on: false }));
    expect(on).toMatch(/^<span aria-hidden="true" class="[^"]*w-3[^"]*"><svg/);
    expect(off).toMatch(/^<span aria-hidden="true" class="[^"]*w-3[^"]*"><\/span>$/);
  });
});
