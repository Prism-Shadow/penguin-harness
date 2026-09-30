/**
 * One look for every picker and menu: Select's panel, row states and check mark, which the UI
 * package owns (`menuPanelClass`, `menuRowClass`, `menuRowTone`, `ChoiceCheck` in
 * components/overlays/menu-panel/menu-panel.tsx), shared by Select, OptionMenu, Dropdown and the
 * pickers built on Dropdown, and the Menu rows built on them. The pieces themselves are tested in
 * the package; this suite checks how the app uses them, as source, because the web suite renders
 * no DOM.
 */
import { describe, expect, it } from "vitest";
import { expectSingleHome, scanSources, sourceFile } from "./helpers/roots";

const SCAN = scanSources();
const text = (id: string) => sourceFile(SCAN, id).text;
const MENU_PANEL = "packages/ui/src/components/overlays/menu-panel/menu-panel.tsx";

describe("menus and pickers", () => {
  it("take the panel, rows and check from the UI package, never a second copy", () => {
    expectSingleHome(SCAN, MENU_PANEL);
    const copies = SCAN.files
      .filter((file) => file.id !== MENU_PANEL)
      .filter((file) =>
        /\b(?:const|function)\s+(?:menuPanelClass|menuRowClass|menuRowTone|ChoiceCheck)\b/.test(
          file.text,
        ),
      )
      .map((file) => file.id);
    expect(copies).toEqual([]);
  });

  it("open Select's panel", () => {
    for (const id of [
      "packages/ui/src/components/forms/select/select.tsx",
      "packages/ui/src/components/forms/select/option-menu.tsx",
      "packages/ui/src/components/overlays/dropdown/dropdown.tsx",
    ]) {
      expect(text(id), id).toContain("${menuPanelClass}");
    }
  });

  it("draw their rows with the Menu family, never a hand-built menu row", () => {
    // The Session row's menu keeps its own rows until the sidebar's rows move into the package.
    const pending = ["packages/web/src/components/ui/session-row-menu.tsx"];
    const handBuilt = SCAN.files
      .filter((file) => file.root === "web" && !pending.includes(file.id))
      .filter((file) => /\bmenuRow(?:Class|Tone)\b/.test(file.text))
      .map((file) => file.id);
    expect(handBuilt).toEqual([]);
  });

  it("mark the current choice with Select's check, never a typed ✓", () => {
    const typed = SCAN.files
      .filter((file) => file.root === "web" && file.name.endsWith(".tsx"))
      .filter((file) => /["'`]✓["'`]/.test(file.text))
      .map((file) => file.id);
    expect(typed).toEqual([]);
  });
});
