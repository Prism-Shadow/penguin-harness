/**
 * The built-in browser's start page (features/builtin-browser/new-tab-page.tsx): what a new tab
 * shows when no homepage is set, decided by `startPageShown` (browser-state.ts) and drawn by the
 * panel over the parked blank page. Static markup from the window's browser store (node env, no
 * DOM).
 *
 * - Given a tab this window opened blank and that is not loading, the panel shows the start page:
 *   the common sites by name.
 * - A tab opened at the homepage never shows it, not even before its first page starts loading;
 *   nor does a page not attached here yet.
 * - Once the tab loads an address, or shows a web page, the start page goes; a crashed tab shows
 *   its crash notice instead.
 * - Picking a site opens it in the tab: the address handed over is one the address bar would
 *   load as it is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BuiltinBrowserServerEvent, BuiltinBrowserTab } from "@prismshadow/penguin-server/api";
import { normalizeAddress } from "../src/features/builtin-browser/address";
import { BuiltinBrowserPanel } from "../src/features/builtin-browser/browser-panel";
import {
  INITIAL_BROWSER_STATE,
  activeTab,
  guestKey,
  reduceBrowser,
  startPageShown,
  type BrowserAction,
  type BrowserState,
} from "../src/features/builtin-browser/browser-state";
import { dispatchBrowser } from "../src/features/builtin-browser/browser-store";
import { NewTabPage, START_PAGE_SITES } from "../src/features/builtin-browser/new-tab-page";
import { S } from "../src/lib/strings";

const BUILTIN = {
  backend: "builtin" as const,
  backends: [{ backend: "builtin" as const, available: true }],
};

function tab(id: number, over: Partial<BuiltinBrowserTab> = {}): BuiltinBrowserTab {
  return {
    id,
    url: "about:blank",
    title: "",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    ...over,
  };
}

const event = (e: BuiltinBrowserServerEvent): BrowserAction => ({ type: "event", event: e });

/** A desktop window that created the page of tab `id` at `url` ("" for a blank one) and hosts it. */
function hosting(id: number, url: string, shown: BuiltinBrowserTab): BrowserAction[] {
  const requestId = `req-${id}-${url}`;
  return [
    { type: "supported", supported: true },
    event({ type: "builtin_browser_open", requestId, url, activate: true }),
    { type: "attached", key: guestKey(requestId), tabId: id },
    { type: "status", status: { available: true, ...BUILTIN, tabs: [shown], activeTabId: id } },
  ];
}

const run = (actions: BrowserAction[]): BrowserState =>
  actions.reduce(reduceBrowser, INITIAL_BROWSER_STATE);

const shows = (state: BrowserState) => startPageShown(state, activeTab(state));

describe("when a tab shows the start page", () => {
  it("shows it on a tab this window opened blank, once nothing is loading", () => {
    expect(shows(run(hosting(7, "", tab(7))))).toBe(true);
  });

  it("never shows it on a tab opened at the homepage, not even before its page starts loading", () => {
    expect(shows(run(hosting(7, "https://home.example/", tab(7, { url: "" }))))).toBe(false);
  });

  it("waits for the page to attach here", () => {
    const status: BrowserAction = {
      type: "status",
      status: { available: true, ...BUILTIN, tabs: [tab(7)], activeTabId: 7 },
    };
    expect(shows(run([{ type: "supported", supported: true }, status]))).toBe(false);
  });

  it.each([
    ["loading an address", tab(7, { loading: true })],
    ["showing a web page", tab(7, { url: "https://example.com/", title: "Example" })],
    ["crashed", tab(7, { crashed: "crashed" })],
  ] as const)("goes once the tab is %s", (_name, shown) => {
    expect(shows(run(hosting(7, "", shown)))).toBe(false);
  });
});

describe("the panel", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { location: { origin: "https://ph.example.com" } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const panel = () => renderToStaticMarkup(createElement(BuiltinBrowserPanel, { active: true }));
  const load = (actions: BrowserAction[]) => actions.forEach(dispatchBrowser);

  it("draws the common sites over a blank tab, and nothing of them over a web page", () => {
    load(hosting(21, "", tab(21)));
    const blank = panel();
    expect(blank).toContain('data-testid="builtin-browser-start-page"');
    for (const site of START_PAGE_SITES) {
      expect(blank).toContain(S.builtinBrowser.startPage.sites[site.id]);
    }

    load(hosting(21, "", tab(21, { url: "https://example.com/", title: "Example" })));
    expect(panel()).not.toContain('data-testid="builtin-browser-start-page"');
  });

  it("shows a crashed blank tab's crash notice, not the start page", () => {
    load(hosting(22, "", tab(22, { crashed: "crashed" })));
    const html = panel();
    expect(html).toContain('data-testid="builtin-browser-crashed"');
    expect(html).not.toContain('data-testid="builtin-browser-start-page"');
  });
});

type Tile = ReactElement<{ onClick: () => void; children?: ReactNode }>;

/** The page's buttons, in order, to reach their handlers. */
function tiles(node: ReactNode): Tile[] {
  return ([] as ReactNode[])
    .concat(node)
    .filter(isValidElement)
    .flatMap((el) => {
      const element = el as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
      if (element.type === "button") return [element as Tile];
      if (typeof element.type === "function") {
        return tiles((element.type as (p: unknown) => ReactNode)(element.props));
      }
      return tiles(element.props.children);
    });
}

describe("picking a site", () => {
  it("opens it in the tab, at an address the address bar would load as it is", () => {
    const onOpen = vi.fn();
    const buttons = tiles(NewTabPage({ onOpen }));
    expect(buttons).toHaveLength(START_PAGE_SITES.length);
    for (const button of buttons) button.props.onClick();
    const opened = onOpen.mock.calls.map(([url]) => url as string);
    expect(opened).toHaveLength(START_PAGE_SITES.length);
    expect(new Set(opened).size).toBe(opened.length);
    for (const url of opened) expect(normalizeAddress(url)).toBe(url);
  });
});
