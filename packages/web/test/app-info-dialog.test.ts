/**
 * The App info dialog's Tab ring (components/account/app-info-dialog.tsx), built the way the
 * dialog's focus trap builds it. The trap (`useDialogLayer` in the UI package's esc-layers) takes
 * every element in the panel that matches `FOCUSABLE_SELECTOR`, in document order, starting with
 * the header's close button. It does not check whether an element is hidden. A Tab stop inside a
 * folded panel cannot take focus, so Tab stalls on it instead of moving.
 *
 * - With both folds closed, the folded panels are mounted (`aria-controls` resolves) but empty.
 *   The last stop is the licences fold, so Tab from it wraps to the close button, and Shift+Tab
 *   from the close button comes back to it.
 * - Opened, the licences fold's links and buttons join the ring after its toggle, and Tab from
 *   the last of them still wraps to the close button.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { nextFocusIndex } from "@prismshadow/penguin-ui";
import { AppInfoBody } from "../src/components/account/app-info-dialog";
import type { AppInfoBodyProps } from "../src/components/account/app-info-dialog";
import { S, setActiveStrings, zh } from "../src/lib/strings";

const CLOSE = "<the header's close button>";

const props = (over: Partial<AppInfoBodyProps> = {}): AppInfoBodyProps => ({
  mode: "release",
  flow: { kind: "up-to-date", version: "0.2.13" },
  currentVersion: "0.2.13",
  buildDate: "2026-09-15",
  locale: "zh",
  notesExpanded: false,
  onToggleNotes: () => {},
  notesPanelId: "notes-panel",
  licensesExpanded: false,
  onToggleLicenses: () => {},
  licensesPanelId: "licenses-panel",
  ...over,
});

const render = (over: Partial<AppInfoBodyProps> = {}): string =>
  renderToStaticMarkup(createElement(AppInfoBody, props(over)));

/**
 * The trap's ring as text names: the close button, then every opening tag in the body that
 * `FOCUSABLE_SELECTOR` matches (an enabled button, a link with an href, an enabled form control,
 * a tabindex other than -1), named by its text with tags stripped.
 */
function tabRing(html: string): string[] {
  const stops: string[] = [];
  const opening = /<(button|a|input|select|textarea|[a-z][a-z0-9]*)\b([^>]*)>/g;
  for (const m of html.matchAll(opening)) {
    const [tag = "", attrs = ""] = [m[1], m[2]];
    const enabled = !/\sdisabled(?:=|\s|$)/.test(attrs);
    const focusable =
      (tag === "button" && enabled) ||
      (tag === "a" && /\shref="/.test(attrs)) ||
      (["input", "select", "textarea"].includes(tag) && enabled) ||
      /\stabindex="(?!-1")[^"]*"/.test(attrs);
    if (!focusable) continue;
    const end = html.indexOf(`</${tag}>`, m.index);
    const inner = end < 0 ? "" : html.slice(m.index + m[0].length, end);
    stops.push(inner.replace(/<[^>]*>/g, "").trim());
  }
  return [CLOSE, ...stops];
}

/** What a panel element (by id) holds, or null when no element carries the id. */
function panelContent(html: string, id: string): string | null {
  const m = new RegExp(`<(\\w+)[^>]*\\sid="${id}"[^>]*>`).exec(html);
  if (m === null) return null;
  const end = html.indexOf(`</${m[1]}>`, m.index);
  return html.slice(m.index + m[0].length, end);
}

afterEach(() => {
  setActiveStrings(zh);
});

describe("the App info dialog's Tab ring", () => {
  it("with both folds closed, Tab wraps from the licences fold to the close button and back", () => {
    const html = render();
    const ring = tabRing(html);
    const licenses = ring.indexOf(S.appInfo.licenses);

    // Both panels are mounted for their toggles' aria-controls, and fold nothing focusable away.
    expect(panelContent(html, "notes-panel")).toBe("");
    expect(panelContent(html, "licenses-panel")).toBe("");
    expect(licenses).toBe(ring.length - 1);
    expect(ring[nextFocusIndex(ring.length, licenses, false)]).toBe(CLOSE);
    expect(ring[nextFocusIndex(ring.length, 0, true)]).toBe(S.appInfo.licenses);
  });

  it("opened, the licences join the ring after their toggle, and Tab still wraps to the close button", () => {
    const html = render({ licensesExpanded: true, notesExpanded: true });
    const ring = tabRing(html);
    const licenses = ring.indexOf(S.appInfo.licenses);

    expect(licenses).toBeGreaterThan(0);
    expect(ring.length - 1).toBeGreaterThan(licenses);
    expect(ring.at(-1)).toBe(S.appInfo.creditsLicenseText);
    expect(ring[nextFocusIndex(ring.length, ring.length - 1, false)]).toBe(CLOSE);
  });
});
