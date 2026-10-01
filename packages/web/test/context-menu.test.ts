/**
 * Guard: how the app uses the row context menu (the UI package's `useRowContextMenu` and its
 * gesture rules). The rules, the hook's own guards and the Dropdown's scroll wiring are the
 * package's `context-menu.test.ts`; what is held here spans the app.
 *
 * - The scan reads every source root, finds the menu modules in one place each, and reports
 *   POSIX-separated paths whatever the platform's separator (the id contract every guard's
 *   path comparison depends on, which only Windows CI would otherwise catch).
 * - No window-, document- or globalThis-level contextmenu listener exists, so the browser's own
 *   menu survives off the row.
 */
import { describe, expect, it } from "vitest";
import { expectEveryRootScanned, expectSingleHome, scanSources } from "./helpers/roots";

/** Every .ts/.tsx under web and the shared UI package (test/helpers/roots.ts). */
const SCAN = scanSources([".ts", ".tsx"]);

/**
 * Every scanned file as [repo-relative id, source] pairs.
 *
 * Ids use forward slashes on every platform: `join` yields `\` on Windows, so a comparison
 * against "packages/web/src/components/ui/…" would silently match nothing there and collapse
 * its assertions into "expected undefined to be defined" — green on Linux, red on the Windows
 * CI job. Callers can rely on POSIX separators on every platform.
 */
function sourceFiles(): Array<[string, string]> {
  return SCAN.files.map((file) => [file.id, file.text]);
}

const DROPDOWN = "packages/ui/src/components/overlays/dropdown/dropdown.tsx";
const CONTEXT_MENU = "packages/ui/src/components/overlays/portal-panel/use-row-context-menu.ts";
const RULES = "packages/ui/src/components/overlays/portal-panel/context-menu.ts";
const SIDEBAR = "packages/web/src/components/layout/sidebar.tsx";

describe("sourceFiles", () => {
  it("scans every source root, and finds the menu modules in one place each", () => {
    expectEveryRootScanned(SCAN);
    for (const id of [DROPDOWN, CONTEXT_MENU, RULES]) {
      expectSingleHome(SCAN, id);
    }
  });

  it("reports POSIX-separated paths whatever the platform's separator is", () => {
    // Pins the contract the assertions below depend on. A no-op assertion on Linux, and
    // the one that fails first on Windows if the normalization is ever dropped.
    const paths = sourceFiles().map(([path]) => path);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((p) => p.includes("\\"))).toEqual([]);
    expect(paths).toContain(CONTEXT_MENU);
    expect(paths).toContain(SIDEBAR);
  });
});

describe("native-menu suppression scope", () => {
  it("registers no global contextmenu listener, so the browser's own menu survives off the row", () => {
    // Matched on the TARGET, not on the call: suppressing the native menu page-wide is the
    // thing to forbid, and only window/document/globalThis can do that. A listener bound to
    // one element suppresses it over that element alone, which is the same scope the
    // sidebar row gets from its onContextMenu prop — the terminal view does exactly this,
    // because a terminal's right-click is its own (copy the selection, else paste).
    const global = sourceFiles().filter(([, src]) =>
      /\b(window|document|globalThis)\.addEventListener\(\s*["']contextmenu["']/.test(src),
    );
    expect(global.map(([path]) => path)).toEqual([]);
  });
});
