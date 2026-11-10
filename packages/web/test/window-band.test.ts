// @vitest-environment jsdom
/**
 * The desktop window's title band as the Web App draws it: the window's own buttons
 * (web-app/window-chrome.tsx) and the app window's band (the app layout's use of it).
 * The desktop shell is faked at its one edge, the bridge its preload hands the page. The layout
 * mounts with the real sidebar column and rail and no contributed section or mode, and a chat
 * module that opens no draft.
 *
 * - Given the bridge on Windows, minimize, maximize and close are drawn and each reaches the
 *   bridge; the middle one reads Restore once the bridge reports the window maximized and Maximize
 *   again once restored; and the page declares that it lays out the band itself, at the bridge's
 *   height, so the shell withdraws its fallback.
 * - Given the bridge on macOS, the page declares the band but draws no window button: the
 *   system's traffic lights are the window's.
 * - Given no bridge (a browser, or an older desktop shell), nothing is drawn and nothing declared.
 * - Given the bridge, the app window has a band holding the sidebar toggle, which is then the only
 *   fold button anywhere; back and forward are available only while the window's history has a
 *   page that way, follow it as it changes, and go there.
 * - Given no bridge, the app window has no band, nothing on it drags the window, and the sidebar
 *   keeps its own fold button.
 * - Given no Navigation API to ask, back and forward stay available.
 */
import { createElement as h } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ChatDrafts } from "../src/features/chat";
import { PagesContext } from "../src/lib/web-app-pages";
import { AppLayout } from "../src/web-app/app-layout";
import { webAppDeps } from "../src/web-app/deps";
import { sidebarDeps, useColumnStateOf, type SidebarDeps } from "../src/web-app/sidebar/deps";
import { CollapsedRail } from "../src/web-app/sidebar/rail";
import { Sidebar } from "../src/web-app/sidebar/sidebar";
import { WindowChrome } from "../src/web-app/window-chrome";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { BackgroundProvider } from "../src/state/background";
import { CompanyProvider } from "../src/features/company/company-state";
import { ThemeProvider } from "../src/state/theme";
import { agentServer, mountAgentApp, whereIs } from "./helpers/agent-app";
import { button, click, mount, run, unmountAll, waitFor } from "./helpers/dom";

/** The shell's bridge, recording what the page asked of it; `maximize` plays the window's side. */
function fakeBridge(platform: "win32" | "darwin" | "linux") {
  const calls: string[] = [];
  let maximized = false;
  const listeners = new Set<(maximized: boolean) => void>();
  const bridge = {
    platform,
    bandHeight: 36,
    isMaximized: () => maximized,
    onMaximizedChange: (listener: (maximized: boolean) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    minimize: () => calls.push("minimize"),
    toggleMaximize: () => calls.push("toggleMaximize"),
    close: () => calls.push("close"),
  };
  vi.stubGlobal("penguinWindow", bridge);
  return {
    calls,
    report: (next: boolean) =>
      run(() => {
        maximized = next;
        for (const listener of listeners) listener(next);
      }),
  };
}

/** The window's history as the Navigation API reports it, changed the way a navigation would. */
function fakeHistory(reach: { canGoBack: boolean; canGoForward: boolean }) {
  const listeners = new Set<() => void>();
  const navigation = {
    ...reach,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal("navigation", navigation);
  return {
    move: (next: { canGoBack: boolean; canGoForward: boolean }) =>
      run(() => {
        Object.assign(navigation, next);
        for (const listener of listeners) listener();
      }),
  };
}

const root = () => document.documentElement;
const band = () => document.querySelector<HTMLElement>('[data-slot="band"]');
const named = (name: string) => [...document.querySelectorAll(`[aria-label="${name}"]`)];
const inBand = (name: string) =>
  band()?.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`) ?? null;

const drafts: ChatDrafts = {
  newChatId: "new",
  useParked: () => [],
  removeParked: () => undefined,
  forgetSession: () => undefined,
  prepareNewChat: () => undefined,
  useNewChat: () => () => undefined,
};
const sidebarWith: SidebarDeps = {
  sections: [],
  modes: [],
  badges: [],
  useModes: () => [],
  useNotes: () => new Map(),
  drafts,
};
const Layout = webAppDeps.provide(
  {
    pages: [],
    pageRenderers: new Map(),
    sessionProviders: [],
    layers: [],
    userEvents: [],
    sidebar: {
      Column: sidebarDeps.provide(sidebarWith, Sidebar),
      Rail: sidebarDeps.provide(sidebarWith, CollapsedRail),
      useColumnState: () => useColumnStateOf(sidebarWith),
    },
    drafts,
  },
  AppLayout,
);
const pages = { pages: [], pending: false, quickStarts: [], refresh: async () => null };

async function mountAppWindow() {
  agentServer();
  return mountAgentApp(
    h(
      PagesContext.Provider,
      { value: pages },
      h(ThemeProvider, null, h(BackgroundProvider, null, h(CompanyProvider, null, h(Layout)))),
    ),
    {
      route: "/home",
      at: "/home",
    },
  );
}

beforeAll(() => setActiveStrings(en));
afterAll(() => setActiveStrings(zh));
afterEach(async () => {
  await unmountAll();
  vi.unstubAllGlobals();
  // The fold is remembered across loads; each scenario starts on a pinned sidebar.
  localStorage.clear();
});

describe("the window's own buttons", () => {
  it("reach the bridge on Windows, and the middle one follows the window's state", async () => {
    const shell = fakeBridge("win32");
    await mount(h(WindowChrome));
    await click(button(en.window.minimize));
    await click(button(en.window.maximize));
    await click(button(en.window.close));
    expect(shell.calls).toEqual(["minimize", "toggleMaximize", "close"]);

    await shell.report(true);
    expect(named(en.window.maximize)).toEqual([]);
    expect(named(en.window.restore)).toHaveLength(1);
    await shell.report(false);
    expect(named(en.window.maximize)).toHaveLength(1);
  });

  it("declare the band at the bridge's height, so the shell's fallback gives way", async () => {
    fakeBridge("linux");
    await mount(h(WindowChrome));
    expect(root().hasAttribute("data-window-controls")).toBe(true);
    expect(root().style.getPropertyValue("--window-band-height")).toContain("36px");
  });

  it("are the system's on macOS: the band is declared, no button drawn", async () => {
    fakeBridge("darwin");
    await mount(h(WindowChrome));
    expect(root().hasAttribute("data-window-controls")).toBe(true);
    expect(named(en.window.close)).toEqual([]);
  });

  it("are neither drawn nor declared without a bridge", async () => {
    await mount(h(WindowChrome));
    expect(root().hasAttribute("data-window-controls")).toBe(false);
    expect(root().style.getPropertyValue("--window-band-height")).toBe("");
    expect(named(en.window.close)).toEqual([]);
  });
});

describe("the app window's band", () => {
  it("holds the sidebar toggle, the only fold button in the window", async () => {
    fakeBridge("win32");
    fakeHistory({ canGoBack: false, canGoForward: false });
    await mountAppWindow();
    await waitFor(() => band() !== null);
    expect(inBand(en.nav.collapseSidebar)).not.toBeNull();
    expect(named(en.nav.collapseSidebar)).toHaveLength(1);

    await click(inBand(en.nav.collapseSidebar)!);
    expect(inBand(en.nav.expandSidebar)).not.toBeNull();
    expect(named(en.nav.expandSidebar)).toHaveLength(1);
  });

  it("offers back and forward only while the history has a page that way, and goes there", async () => {
    fakeBridge("win32");
    const history = fakeHistory({ canGoBack: false, canGoForward: false });
    const router = await mountAppWindow();
    await waitFor(() => band() !== null);
    expect(inBand(en.nav.back)!.disabled).toBe(true);
    expect(inBand(en.nav.forward)!.disabled).toBe(true);

    await history.move({ canGoBack: true, canGoForward: false });
    expect(inBand(en.nav.back)!.disabled).toBe(false);
    expect(inBand(en.nav.forward)!.disabled).toBe(true);
    await click(inBand(en.nav.back)!);
    expect(whereIs(router)).toBe("/chat");
  });

  it("keeps back and forward available when the Navigation API cannot be asked", async () => {
    fakeBridge("win32");
    await mountAppWindow();
    await waitFor(() => band() !== null);
    expect(inBand(en.nav.back)!.disabled).toBe(false);
    expect(inBand(en.nav.forward)!.disabled).toBe(false);
  });

  it("is not there without a bridge: nothing drags, and the sidebar keeps its fold button", async () => {
    fakeHistory({ canGoBack: true, canGoForward: true });
    await mountAppWindow();
    await waitFor(() => named(en.nav.collapseSidebar).length > 0);
    expect(band()).toBeNull();
    expect(document.querySelector("[data-window-drag]")).toBeNull();
    expect(named(en.nav.collapseSidebar)).toHaveLength(1);
    expect(named(en.nav.back)).toEqual([]);
  });
});
