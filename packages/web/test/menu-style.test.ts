/**
 * Guard: one look for every picker and menu. Select's panel, row states and check mark are the
 * UI package's (`menuPanelClass`, `menuRowClass`, `menuRowTone`, `ChoiceCheck` in
 * components/overlays/menu-panel/menu-panel.tsx) and are tested there; this holds how the app
 * uses them.
 *
 * - No web module hand-builds a menu row from the row classes (the Session row menu pending).
 * - No web module marks the current choice with a typed ✓.
 */
import { describe, expect, it } from "vitest";
import { expectEveryRootScanned, scanSources } from "./helpers/roots";

const SCAN = scanSources();

describe("menus and pickers", () => {
  it("are looked for in every source root", () => {
    expectEveryRootScanned(SCAN);
  });

  it("draw their rows with the Menu family, never a hand-built menu row", () => {
    const handBuilt = SCAN.files
      .filter((file) => file.root === "web")
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
