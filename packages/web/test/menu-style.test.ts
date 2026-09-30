/**
 * Guard: one look for every picker and menu. Select's panel, row states and check mark are the
 * UI package's (`menuPanelClass`, `menuRowClass`, `menuRowTone`, `ChoiceCheck` in
 * components/overlays/menu-panel/menu-panel.tsx) and are tested there; this holds how the app
 * uses them.
 *
 * - The panel, rows and check live in the UI package, and no other file declares a copy.
 * - No web module hand-builds a menu row from the row classes (the Session row menu pending).
 * - No web module marks the current choice with a typed ✓.
 */
import { describe, expect, it } from "vitest";
import { expectSingleHome, scanSources } from "./helpers/roots";

const SCAN = scanSources();
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
