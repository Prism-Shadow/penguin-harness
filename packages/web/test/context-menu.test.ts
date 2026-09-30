/**
 * How the app uses the row context menu (the UI package's `useRowContextMenu` and its gesture
 * rules, under components/overlays/portal-panel/, driving a `Dropdown` in `anchorRect` mode). The
 * rules, the hook's own guards and the Dropdown's scroll wiring are the package's
 * `context-menu.test.ts`; what is pinned here spans the app.
 *
 * **Suppression scope**: preventing the browser's own menu is correct on the row and wrong
 * everywhere else, and nothing in a node-only suite (`environment: "node"`, no jsdom) would notice
 * a `preventDefault` that had crept onto a document-level listener — so the scan asserts there is
 * no global contextmenu listener in either root. And the feature must not be mouse-only: the
 * sidebar's Session rows spread all three openers (right-click, Shift+F10, press-and-hold) and
 * name the anchor's owner, which the scroll rule needs to leave a menu open while an unrelated
 * container scrolls.
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

  it("gives the sidebar row all three openers, so the menu is not mouse-only", () => {
    const sidebar = sourceFiles().find(([path]) => path === SIDEBAR);
    expect(sidebar).toBeDefined();
    // The row spreads the hook's handlers (contextmenu + Shift+F10 + press-and-hold) and
    // guards its own click against the one a hold replays.
    expect(sidebar![1]).toContain("{...ctx.rowProps}");
    expect(sidebar![1]).toContain("ctx.consumeLongPressClick()");
  });

  it("names the anchor's owner alongside the anchor, so the scroll rule has one to test", () => {
    // Without the wiring, scrollMovesAnchor is asked about a null owner on every scroll and
    // answers "dismiss" — the package's rule tests would still pass while the bug was back.
    const sidebar = sourceFiles().find(([path]) => path === SIDEBAR);
    expect(sidebar![1]).toContain("anchorOwner={ctx.anchorOwner}");
  });
});
