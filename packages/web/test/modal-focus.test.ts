/**
 * Focus behaviour of the Modal primitive (the UI package's
 * src/components/overlays/modal/modal.tsx), which every dialog in the app inherits: focus enters
 * the panel on open, Tab and Shift+Tab cycle inside it, and focus returns to the trigger on close.
 * The wiring lives in `useDialogLayer` (src/components/overlays/esc-layers/esc-layers.ts), which
 * the command palette and the harness history overlay share with Modal, so what is pinned here
 * holds for those two as well.
 *
 * `nextFocusIndex` is the arithmetic and is exercised directly. The wiring around it cannot
 * be: this suite is `environment: "node"` with no jsdom, and Modal renders through
 * `createPortal(…, document.body)`, so it cannot even be handed to `renderToStaticMarkup` the
 * way the UI package's field.test.ts renders Field. So the wiring is asserted against the
 * source, the way portal-panel-dismiss.test.ts asserts its hook's listeners — thin, but it pins
 * the parts that are silent when they break: an aria attribute that reappears inside the
 * `headerless` branch names only half the dialogs, and a restore target read one commit too late
 * is a dialog that hands focus back to itself.
 */
import { describe, expect, it } from "vitest";
import { nextFocusIndex } from "@prismshadow/penguin-ui";
import { expectEveryRootScanned, expectSingleHome, scanSources, sourceFile } from "./helpers/roots";

const SCAN = scanSources();
const MODAL = "packages/ui/src/components/overlays/modal/modal.tsx";
const LAYER = "packages/ui/src/components/overlays/esc-layers/esc-layers.ts";
const DROPDOWN = "packages/ui/src/components/overlays/dropdown/dropdown.tsx";
const modal = sourceFile(SCAN, MODAL).text;
const layer = sourceFile(SCAN, LAYER).text;
/** `useDialogLayer`'s body: the focus wiring, without the Escape hook declared above it. */
const dialogLayer = layer.slice(layer.indexOf("export function useDialogLayer("));
const dropdown = sourceFile(SCAN, DROPDOWN).text;

describe("the dialog primitives' sources", () => {
  it("scan every source root, and find Modal, its layer and Dropdown in one place each", () => {
    expectEveryRootScanned(SCAN);
    expectSingleHome(SCAN, MODAL);
    expectSingleHome(SCAN, LAYER);
    expectSingleHome(SCAN, DROPDOWN);
    expect(layer).toContain("export function useDialogLayer(");
  });
});

/** The panel div's opening tag — the element carrying the dialog's role and its focus wiring. */
function panelTag(): string {
  const tag = /<div\n\s+ref=\{panelRef\}[\s\S]*?\n {6}>/.exec(modal);
  expect(tag, "the panel div should carry ref={panelRef}").not.toBeNull();
  return tag![0];
}

/** The `useEffect(...)` block of `src` holding `marker`, up to and including its dependencies. */
function effectWith(src: string, marker: string): string {
  const at = src.indexOf(marker);
  expect(at, `expected ${marker} in esc-layers.ts`).toBeGreaterThan(-1);
  const start = src.lastIndexOf("useEffect(", at);
  expect(start, `${marker} should sit inside a useEffect`).toBeGreaterThan(-1);
  const deps = src.indexOf("}, [", at);
  return src.slice(start, src.indexOf(");", deps) + 2);
}

describe("nextFocusIndex", () => {
  it("steps forward and wraps past the last element", () => {
    expect(nextFocusIndex(3, 0, false)).toBe(1);
    expect(nextFocusIndex(3, 2, false)).toBe(0);
  });

  it("steps backward and wraps past the first element", () => {
    expect(nextFocusIndex(3, 2, true)).toBe(1);
    expect(nextFocusIndex(3, 0, true)).toBe(2);
  });

  it("enters the ring at the end the direction implies when focus is on the panel itself", () => {
    // -1 is focus sitting on the container: a dialog whose focusable content mounted after
    // open, or one whose only control was just disabled. Shift+Tab must reach the last
    // element, not the second-to-last — the plain modulo gets this wrong.
    expect(nextFocusIndex(4, -1, false)).toBe(0);
    expect(nextFocusIndex(4, -1, true)).toBe(3);
  });

  it("holds a single-element ring in place rather than escaping it", () => {
    expect(nextFocusIndex(1, 0, false)).toBe(0);
    expect(nextFocusIndex(1, 0, true)).toBe(0);
  });
});

describe("Modal dialog semantics", () => {
  it("is a modal dialog on both branches, not only the headerless one", () => {
    const tag = panelTag();
    expect(tag).toContain('role="dialog"');
    expect(tag).toContain('aria-modal="true"');
    // The branch may only choose HOW the dialog is named. A role that moved back inside it
    // would leave every titled dialog — the majority — as an unannounced div.
    const branch = /\{\.\.\.\(headerless[\s\S]*?\)\}/.exec(tag);
    expect(branch, "the headerless branch should be a spread on the panel").not.toBeNull();
    expect(branch![0]).not.toContain("role");
    expect(branch![0]).not.toContain("aria-modal");
  });

  it("names the titled branch from its own heading instead of a second copy of the string", () => {
    expect(panelTag()).toContain('"aria-labelledby": titleId');
    expect(modal).toContain("<h2 id={titleId}");
    // The headerless branch has no heading to point at, so it keeps the string itself.
    expect(panelTag()).toContain('"aria-label": title');
  });

  it("keeps the container focusable so a dialog with no controls can still hold focus", () => {
    expect(panelTag()).toContain("tabIndex={-1}");
  });

  it("takes its keyboard wiring from the shared dialog layer", () => {
    expect(modal).toContain("useDialogLayer(open, panelRef, onClose)");
    expect(panelTag()).toContain("onKeyDown={onPanelKeyDown}");
  });
});

describe("Modal focus containment", () => {
  it("moves focus into the panel on open, yielding to a child that autofocused", () => {
    const effect = effectWith(dialogLayer, "FOCUSABLE_SELECTOR) ?? panel");
    // A child with autoFocus is focused during the commit, before this effect runs; stealing
    // focus back to the close button would undo it at every call site that uses autoFocus.
    expect(effect).toContain("!panel.contains(document.activeElement)");
    expect(effect).toContain("[open]");
  });

  it("returns focus on every close path", () => {
    // Keyed on `open` alone, so the cleanup runs for Escape, the close button, the overlay
    // mousedown, the prop going false, and an outright unmount alike.
    const effect = effectWith(dialogLayer, "restoreFocusRef.current?.focus()");
    expect(effect).toContain("return () => restoreFocusRef.current?.focus();");
    expect(effect).toContain("[open]");
  });

  it("reads the element to return to during render, before any effect can run", () => {
    // autoFocus fires in the same commit, so an effect-time read would capture a node inside
    // the dialog and hand focus back to the dialog that just closed.
    const capture = dialogLayer.indexOf("restoreFocusRef.current =");
    expect(capture).toBeGreaterThan(-1);
    expect(capture).toBeLessThan(dialogLayer.indexOf("useEffect("));
  });

  it("cycles Tab within the panel, and yields to the two things that own it first", () => {
    const handler = /const onPanelKeyDown = [\s\S]*?\n {2}\};/.exec(dialogLayer);
    expect(handler, "onPanelKeyDown should be declared in useDialogLayer").not.toBeNull();
    const body = handler![0];
    expect(body).toContain("nextFocusIndex(");
    expect(body).toContain("e.shiftKey");
    expect(body).toContain("e.preventDefault()");
    // A control that drives Tab itself (the composer's slash picker accepts a completion with
    // it) marks the event handled.
    expect(body).toContain("e.defaultPrevented");
    // A menu or popover opened inside the dialog is portaled out of this subtree but still
    // bubbles here as a React child; it owns its own focus while it is open.
    expect(body).toContain("panel?.contains(document.activeElement)");
  });

  it("leaves Escape on the layer stack, so only the topmost dialog closes", () => {
    expect(dialogLayer).toContain("useEscLayer(open, onClose)");
    expect(effectWith(layer, "const id = pushEscLayer();")).toContain("isTopEscLayer(id)");
  });
});

describe("focusable selector", () => {
  it("is shared with Dropdown rather than copied into it", () => {
    expect(layer).toContain("export const FOCUSABLE_SELECTOR =");
    expect(dropdown).toContain("querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)");
    expect(dropdown).not.toContain("a[href]");
  });

  it("keeps visually hidden controls in the ring", () => {
    // The app's file pickers are hidden the `sr-only` way — position/clip, not `display:
    // none` — specifically so they stay Tab-reachable (hidden-file-input.tsx). A selector
    // narrowed to visible boxes would drop every "upload" and "import" control in a dialog.
    expect(layer).toContain("input:not([disabled])");
    expect(layer).not.toContain("offsetParent");
  });
});
