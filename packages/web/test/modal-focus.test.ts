/**
 * Focus behaviour of the Modal primitive (src/components/ui/modal.tsx), which every dialog in
 * the app inherits: focus enters the panel on open, Tab and Shift+Tab cycle inside it, and
 * focus returns to the trigger on close.
 *
 * `nextFocusIndex` is the arithmetic and is exercised directly. The wiring around it cannot
 * be: this suite is `environment: "node"` with no jsdom, and Modal renders through
 * `createPortal(…, document.body)`, so it cannot even be handed to `renderToStaticMarkup` the
 * way info-popover.test.ts renders Field. So the wiring is asserted against the source, the
 * way portal-panel-dismiss.test.ts asserts its hook's listeners — thin, but it pins the parts
 * that are silent when they break: an aria attribute that reappears inside the `headerless`
 * branch names only half the dialogs, and a restore target read one commit too late is a
 * dialog that hands focus back to itself.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { nextFocusIndex } from "../src/components/ui/modal";

const modal = readFileSync(
  fileURLToPath(new URL("../src/components/ui/modal.tsx", import.meta.url)),
  "utf8",
);
const dropdown = readFileSync(
  fileURLToPath(new URL("../src/components/ui/dropdown.tsx", import.meta.url)),
  "utf8",
);

/** The panel div's opening tag — the element carrying the dialog's role and its focus wiring. */
function panelTag(): string {
  const tag = /<div\n\s+ref=\{panelRef\}[\s\S]*?\n {6}>/.exec(modal);
  expect(tag, "the panel div should carry ref={panelRef}").not.toBeNull();
  return tag![0];
}

/** The `useEffect(...)` block containing `marker`, up to and including its dependency array. */
function effectWith(marker: string): string {
  const at = modal.indexOf(marker);
  expect(at, `expected ${marker} in modal.tsx`).toBeGreaterThan(-1);
  const start = modal.lastIndexOf("useEffect(", at);
  expect(start, `${marker} should sit inside a useEffect`).toBeGreaterThan(-1);
  const deps = modal.indexOf("}, [", at);
  return modal.slice(start, modal.indexOf(");", deps) + 2);
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
});

describe("Modal focus containment", () => {
  it("moves focus into the panel on open, yielding to a child that autofocused", () => {
    const effect = effectWith("FOCUSABLE_SELECTOR) ?? panel");
    // A child with autoFocus is focused during the commit, before this effect runs; stealing
    // focus back to the close button would undo it at every call site that uses autoFocus.
    expect(effect).toContain("!panel.contains(document.activeElement)");
    expect(effect).toContain("[open]");
  });

  it("returns focus on every close path", () => {
    // Keyed on `open` alone, so the cleanup runs for Escape, the close button, the overlay
    // mousedown, the prop going false, and an outright unmount alike.
    const effect = effectWith("restoreFocusRef.current?.focus()");
    expect(effect).toContain("return () => restoreFocusRef.current?.focus();");
    expect(effect).toContain("[open]");
  });

  it("reads the element to return to during render, before any effect can run", () => {
    // autoFocus fires in the same commit, so an effect-time read would capture a node inside
    // the dialog and hand focus back to the dialog that just closed.
    const capture = modal.indexOf("restoreFocusRef.current =");
    expect(capture).toBeGreaterThan(-1);
    expect(capture).toBeLessThan(modal.indexOf("useEffect("));
  });

  it("cycles Tab within the panel, and yields to the two things that own it first", () => {
    const handler = /const onPanelKeyDown = [\s\S]*?\n {2}\};/.exec(modal);
    expect(handler, "onPanelKeyDown should be declared in modal.tsx").not.toBeNull();
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
    expect(effectWith("const id = pushEscLayer();")).toContain("isTopEscLayer(id)");
  });
});

describe("focusable selector", () => {
  it("is shared with Dropdown rather than copied into it", () => {
    expect(modal).toContain("export const FOCUSABLE_SELECTOR =");
    expect(dropdown).toContain("querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)");
    expect(dropdown).not.toContain("a[href]");
  });

  it("keeps visually hidden controls in the ring", () => {
    // The app's file pickers are hidden the `sr-only` way — position/clip, not `display:
    // none` — specifically so they stay Tab-reachable (hidden-file-input.tsx). A selector
    // narrowed to visible boxes would drop every "upload" and "import" control in a dialog.
    expect(modal).toContain("input:not([disabled])");
    expect(modal).not.toContain("offsetParent");
  });
});
