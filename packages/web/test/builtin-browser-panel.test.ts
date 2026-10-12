/**
 * The Browser panel (features/builtin-browser/browser-panel.tsx) while the agents drive the
 * user's own Chrome, rendered to static markup from the window's browser store (node env, no
 * DOM), its menu's backend rows, and the backend switch against the fetch fake.
 *
 * - Connected: the strip lists the tabs in the user's Chrome and the page area is the card saying
 *   the tab is open in Chrome, with Show in Chrome; no slot is laid out for a built-in page.
 * - Connected with no tab yet: the card says where the agents' pages will appear.
 * - No Chrome paired: the pairing steps with this server's address, while the panel is on screen;
 *   a hidden panel draws none of it.
 * - Paired but not connected: which Chrome, and the reconnect help.
 * - The admin switched Chrome connections off: the panel says so.
 * - A window whose built-in browser cannot run offers the user's Chrome instead.
 * - The menu offers the choice of backend only where both are offered; the Chrome row says how
 *   the user's Chrome stands, with the pairing dialog while none is paired and Settings once one
 *   is, and no action while the admin's switch is off.
 * - Switching while an agent acts is refused: a toast says to wait, nothing asks, nothing moves.
 *   A switch that goes through moves the window, says so, and reads the new backend's status.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  BrowserBackendInfo,
  BuiltinBrowserStatus,
  BuiltinBrowserTab,
} from "@prismshadow/penguin-server/api";
import { Menu } from "@prismshadow/penguin-ui";
import { BuiltinBrowserPanel } from "../src/features/builtin-browser/browser-panel";
import { BackendMenuRows } from "../src/features/builtin-browser/backend-menu";
import { switchBrowserBackend } from "../src/features/builtin-browser/browser-actions";
import { browserState, dispatchBrowser } from "../src/features/builtin-browser/browser-store";
import { S } from "../src/lib/strings";
import { apiError, json, stubFetch } from "./helpers/fetch";

/** Toasts raised during a test, by kind (the real store would leave its dismiss timers running). */
const toasts = vi.hoisted(() => [] as string[]);

vi.mock("@prismshadow/penguin-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@prismshadow/penguin-ui")>();
  return {
    ...actual,
    toastSuccess: (text: string) => toasts.push(`success: ${text}`),
    toastAttention: (text: string) => toasts.push(`attention: ${text}`),
    toastError: (text: string) => toasts.push(`error: ${text}`),
  };
});

const ORIGIN = "https://ph.example.com";

const tab = (id: number, title: string, url: string): BuiltinBrowserTab => ({
  id,
  title,
  url,
  loading: false,
  canGoBack: false,
  canGoForward: false,
});

const CHROME: BrowserBackendInfo = {
  backend: "chrome",
  available: true,
  extension: {
    id: "ext-1",
    name: "Chrome 130 on macOS",
    version: "0.2.13",
    connected: true,
    lastSeenAt: "2026-10-02T09:00:00.000Z",
  },
};
const UNPAIRED: BrowserBackendInfo = {
  backend: "chrome",
  available: false,
  reason: "extension_not_paired",
};
const DISCONNECTED: BrowserBackendInfo = {
  ...CHROME,
  available: false,
  reason: "extension_disconnected",
  extension: { ...CHROME.extension!, connected: false },
};
const DISABLED: BrowserBackendInfo = {
  backend: "chrome",
  available: false,
  reason: "extension_disabled",
};
const BUILTIN: BrowserBackendInfo = { backend: "builtin", available: true };

function status(
  backend: "builtin" | "chrome",
  backends: BrowserBackendInfo[],
  tabs: BuiltinBrowserTab[] = [],
  activeTabId: number | null = null,
): BuiltinBrowserStatus {
  const entry = backends.find((b) => b.backend === backend)!;
  return {
    available: entry.available,
    ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
    backend,
    backends,
    tabs,
    activeTabId,
  };
}

/** The text of the element carrying `testId` in rendered markup, or null without one. */
const textOf = (html: string, testId: string): string | null =>
  new RegExp(`data-testid="${testId}"[^>]*>([^<]*)<`).exec(html)?.[1] ?? null;

/** The window's store as the server last answered. */
const set = (s: BuiltinBrowserStatus) => dispatchBrowser({ type: "status", status: s });

const panel = (active = true) =>
  renderToStaticMarkup(createElement(BuiltinBrowserPanel, { active }));

beforeEach(() => {
  vi.stubGlobal("window", { location: { origin: ORIGIN } });
  dispatchBrowser({ type: "supported", supported: false });
});
afterEach(() => {
  toasts.length = 0;
});

describe("the Chrome surface", () => {
  it("lists the tabs in the user's Chrome, and stands a card for the page with Show in Chrome", () => {
    set(
      status(
        "chrome",
        [CHROME],
        [
          tab(1201, "Your Orders", "https://www.amazon.com/your-orders"),
          tab(1202, "Google", "https://www.google.com/"),
        ],
        1201,
      ),
    );
    const html = panel();
    expect(html).toContain('data-standing="connected"');
    expect(html.split('data-testid="builtin-browser-tab"').length - 1).toBe(2);
    expect(html).toContain(S.builtinBrowser.chromeTabCard);
    expect(html).toContain("https://www.amazon.com/your-orders");
    expect(html).toContain(`>${S.builtinBrowser.showInChrome}<`);
    expect(html).not.toContain('data-testid="builtin-browser-viewport"');
  });

  it("says where the agents' pages will appear while Chrome holds none of them", () => {
    set(status("chrome", [CHROME]));
    const html = panel();
    expect(html).toContain(S.builtinBrowser.chromeNoTabsTitle);
    expect(html).not.toContain(S.builtinBrowser.showInChrome);
  });

  it("shows the pairing steps with this server's address while no Chrome is paired, on screen only", () => {
    set(status("chrome", [UNPAIRED]));
    const html = panel();
    expect(html).toContain('data-standing="unpaired"');
    expect(textOf(html, "browser-pairing-server")).toBe(ORIGIN);
    expect(html).toContain(S.builtinBrowser.pairStepInstall);
    expect(panel(false)).not.toContain("browser-pairing-server");
  });

  it("names the paired Chrome that is not connected, with the reconnect help", () => {
    set(status("chrome", [DISCONNECTED]));
    const html = panel();
    expect(html).toContain(S.builtinBrowser.chromeDisconnectedTitle);
    expect(html).toContain(S.builtinBrowser.chromeDisconnectedBody("Chrome 130 on macOS"));
    expect(html).toContain(S.builtinBrowser.reconnectHelp);
    expect(html).not.toContain("browser-pairing-server");
  });

  it("says the admin switched Chrome connections off", () => {
    set(status("chrome", [DISABLED]));
    const html = panel();
    expect(html).toContain(S.builtinBrowser.chromeDisabledTitle);
    expect(html).toContain(S.builtinBrowser.chromeDisabledBody);
  });

  it("offers the user's Chrome where the built-in browser cannot run in this window", () => {
    set(status("builtin", [BUILTIN, UNPAIRED]));
    const html = panel();
    expect(html).toContain(S.builtinBrowser.unavailableTitle);
    expect(html).toContain(`>${S.builtinBrowser.useChrome}<`);
  });
});

type Row = ReactElement<{ label: ReactNode; onSelect?: () => void; checked?: boolean }>;

/** The menu rows as BackendMenuRows returns them, to reach their handlers. */
function rows(props: Parameters<typeof BackendMenuRows>[0]): Row[] {
  const out = BackendMenuRows(props);
  if (out === null) return [];
  const walk = (node: ReactNode): Row[] =>
    ([] as ReactNode[])
      .concat(node)
      .filter(isValidElement)
      .flatMap((el) => {
        const props = (el as ReactElement<{ children?: ReactNode; label?: ReactNode }>).props;
        return props.label !== undefined ? [el as Row] : walk(props.children);
      });
  return walk(out);
}

describe("the menu's backend rows", () => {
  const handlers = () => ({ onPick: vi.fn(), onConnect: vi.fn(), onManage: vi.fn() });

  it("offers Built-in and System Chrome where both are offered, the chosen one checked", () => {
    set(status("builtin", [BUILTIN, CHROME]));
    const h = handlers();
    const menu = renderToStaticMarkup(
      createElement(Menu, {
        density: "sm",
        children: createElement(BackendMenuRows, { state: browserState(), ...h }),
      }),
    );
    expect(menu).toContain(S.builtinBrowser.backendGroup);
    const [builtin, chrome] = rows({ state: browserState(), ...h });
    expect(builtin!.props.checked).toBe(true);
    expect(chrome!.props.checked).toBe(false);
    chrome!.props.onSelect!();
    expect(h.onPick).toHaveBeenCalledExactlyOnceWith("chrome");
  });

  it("offers no choice where only the user's Chrome is offered", () => {
    set(status("chrome", [CHROME]));
    const labels = rows({ state: browserState(), ...handlers() }).map((r) => r.props.label);
    expect(labels).toEqual([S.builtinBrowser.chromeConnected("Chrome 130 on macOS")]);
  });

  it.each([
    ["connected", CHROME, "onManage"],
    ["not connected", DISCONNECTED, "onManage"],
    ["not paired", UNPAIRED, "onConnect"],
  ] as const)("acts on a Chrome %s through the right door", (_name, info, door) => {
    set(status("chrome", [info]));
    const h = handlers();
    const [row] = rows({ state: browserState(), ...h });
    row!.props.onSelect!();
    expect(h[door]).toHaveBeenCalledOnce();
  });

  it("gives the row no action while the admin's switch is off", () => {
    set(status("chrome", [DISABLED]));
    const [row] = rows({ state: browserState(), ...handlers() });
    expect(row!.props.label).toBe(S.builtinBrowser.chromeDisabled);
    expect(row!.props.onSelect).toBeUndefined();
  });
});

describe("switching the backend", () => {
  it("is refused while an agent acts: a toast says to wait, and the window stays put", async () => {
    set(status("builtin", [BUILTIN, CHROME]));
    const fetch = stubFetch(() => apiError(409, "action_in_flight"));
    expect(await switchBrowserBackend("chrome")).toBe(false);
    expect(toasts).toEqual([`attention: ${S.builtinBrowser.switchRefused}`]);
    expect(browserState().backend).toBe("builtin");
    expect(fetch.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "PUT /api/builtin-browser/backend",
    ]);
  });

  it("moves the window once the server agrees, says so, and reads the new backend's status", async () => {
    set(status("builtin", [BUILTIN, CHROME]));
    const fetch = stubFetch((r) =>
      r.method === "PUT"
        ? json({ backend: "chrome", choices: ["builtin", "chrome"] })
        : json(
            status("chrome", [BUILTIN, CHROME], [tab(1201, "Docs", "https://docs.example/")], 1201),
          ),
    );
    expect(await switchBrowserBackend("chrome")).toBe(true);
    expect(fetch.requests[0]!.body).toEqual({ backend: "chrome" });
    expect(toasts).toEqual([`success: ${S.builtinBrowser.switchedToChrome}`]);
    expect(browserState().backend).toBe("chrome");
    expect(browserState().chrome.tabs.map((t) => t.id)).toEqual([1201]);
    expect(fetch.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "PUT /api/builtin-browser/backend",
      "GET /api/builtin-browser/status",
    ]);
  });
});
