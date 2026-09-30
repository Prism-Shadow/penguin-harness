/**
 * One look for every picker and menu: Select's panel, row states and check mark
 * (components/ui/field.tsx: `menuPanelClass`, `menuRowTone`, `ChoiceCheck`), shared by Select,
 * OptionMenu, Dropdown and the pickers built on Dropdown. Checked as source, because the web
 * suite renders no DOM.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ChoiceCheck, menuRowTone } from "../src/components/ui/field";
import { scanSources, sourceFile } from "./helpers/roots";

const SCAN = scanSources();
const text = (id: string) => sourceFile(SCAN, `packages/web/src/${id}`).text;

describe("menus and pickers", () => {
  it("open Select's panel", () => {
    for (const id of [
      "components/ui/select.tsx",
      "components/ui/option-menu.tsx",
      "components/ui/dropdown.tsx",
    ]) {
      expect(text(id), id).toContain("${menuPanelClass}");
    }
  });

  it("mark the current choice with Select's check, never a typed ✓", () => {
    const typed = SCAN.files
      .filter((file) => file.root === "web" && file.name.endsWith(".tsx"))
      .filter((file) => /["'`]✓["'`]/.test(file.text))
      .map((file) => file.id);
    expect(typed).toEqual([]);
    expect(renderToStaticMarkup(createElement(ChoiceCheck, { on: true }))).toContain("<svg");
    expect(renderToStaticMarkup(createElement(ChoiceCheck, { on: false }))).not.toContain("<svg");
  });

  it("fill the current choice and only hover the rest", () => {
    expect(menuRowTone(true)).toContain("font-medium");
    expect(menuRowTone(true)).not.toContain("hover:");
    expect(menuRowTone(false)).toContain("hover:bg-gray-100");
  });
});
