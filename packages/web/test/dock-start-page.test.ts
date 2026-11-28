// @vitest-environment jsdom
/**
 * The dock's start page (features/dock/dock-panel.tsx over the dock store): what an open dock
 * shows once its last tab is gone.
 *
 * - Given a dock showing one tab, when its × closes that tab, then the dock stays open on its
 *   start page, the start page's tiles are the "+" menu's choices in the menu's order, and the
 *   focus the × had lands on the first tile; the dock's own × then puts the dock away.
 * - Given a dock showing one tab while the person types elsewhere, when that tab is closed by
 *   something other than its ×, then the start page appears and the focus stays where it was.
 */
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createElement as h, useSyncExternalStore } from "react";
import { click, mount, run, unmountAll, waitFor } from "./helpers/dom";

let dock: typeof import("../src/features/dock/dock-state");
let DockPanel: typeof import("../src/features/dock/dock-panel").DockPanel;
let registerDockPanel: typeof import("../src/features/dock/panel-registry").registerDockPanel;

/** A media query that never matches (jsdom has no `matchMedia`): a wide window, a mouse. */
const unmatchedQuery = (media: string) => ({
  matches: false,
  media,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
});

beforeAll(async () => {
  vi.stubGlobal("matchMedia", unmatchedQuery);
  dock = await import("../src/features/dock/dock-state");
  ({ DockPanel } = await import("../src/features/dock/dock-panel"));
  ({ registerDockPanel } = await import("../src/features/dock/panel-registry"));
});

const unregister: (() => void)[] = [];
let scope = 0;
beforeEach(() => {
  vi.stubGlobal("matchMedia", unmatchedQuery);
  for (const [id, order] of [
    ["test-notes", 1],
    ["test-board", 2],
    ["test-log", 3],
  ] as const)
    unregister.push(
      registerDockPanel({
        id,
        label: () => `Panel ${id}`,
        glyph: "M4 4h16v16H4z",
        order,
        Body: () => h("p", null, id),
      }),
    );
  scope += 1;
  dock.setDockScope(`start-page-${scope}`);
});

afterEach(async () => {
  await unmountAll();
  for (const done of unregister.splice(0)) done();
});

/** The right dock as the chat page renders it: whatever the store shows, nothing when closed. */
function RightDock() {
  useSyncExternalStore(dock.subscribeDock, dock.dockVersion);
  const view = dock.dockViews().find((candidate) => candidate.position === "right");
  return view ? h(DockPanel, { view, animateEntrance: false }) : null;
}

const rightDockOpen = () =>
  document.querySelector('[data-testid="dock"][data-position="right"][data-open="true"]') !== null;
const tileKeys = () =>
  [...document.querySelectorAll<HTMLElement>("[data-launch-key]")].map(
    (tile) => tile.dataset["launchKey"],
  );

it("closing the last tab leaves the dock open on its start page, which the dock's × puts away", async () => {
  dock.openPanel("test-board", "right");
  await mount(h(RightDock));
  expect(rightDockOpen()).toBe(true);

  await click(document.querySelector('[data-testid="dock-tab-close"]')!);
  await waitFor(() => document.querySelector('[data-testid="dock-picker"]') !== null);
  expect(rightDockOpen()).toBe(true);
  expect(document.activeElement).toBe(document.querySelector("[data-launch-key]"));

  await click(document.querySelector('[data-testid="dock-add"]')!);
  const menu = [...document.querySelectorAll<HTMLElement>('[data-testid^="dock-add-"]')].map(
    (row) => row.dataset["testid"]!.slice("dock-add-".length),
  );
  expect(menu).toEqual(["test-notes", "test-board", "test-log"]);
  expect(tileKeys()).toEqual(menu);

  await click(document.querySelector('[data-testid="dock-close"]')!);
  expect(rightDockOpen()).toBe(false);
  expect(dock.isDockVisible("right")).toBe(false);
});

it("a tab closed from elsewhere leaves the focus where the person was typing", async () => {
  dock.openPanel("test-log", "right");
  const composer = document.createElement("textarea");
  document.body.appendChild(composer);
  await mount(h(RightDock));
  composer.focus();

  await run(() => dock.closePanel("test-log"));
  await waitFor(() => document.querySelector('[data-testid="dock-picker"]') !== null);
  expect(rightDockOpen()).toBe(true);
  expect(document.activeElement).toBe(composer);
});
