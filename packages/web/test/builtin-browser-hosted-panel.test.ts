/**
 * The Browser panel of a server's own Chrome (features/builtin-browser/hosted-panel.tsx),
 * rendered to static markup from the window's browser store (node env, no DOM), and the panel's
 * requests against the fetch fake.
 *
 * - A machine's panel shows that machine's browser, whatever this server's is.
 * - No Chrome on the machine, or one that did not start: the page area says so, with what
 *   Chrome printed and what to do. A server that offers none, and one whose agents drive
 *   another browser, each say that instead.
 * - With Chrome able to run and no tab, the page area says where pages will appear.
 * - The menu of a machine's panel offers neither the user's Chrome nor its row; this server's
 *   lists Chrome on this machine beside the others.
 * - The panel's requests go to the server it belongs to, and change only that server's state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BrowserBackendInfo, BuiltinBrowserStatus } from "@prismshadow/penguin-server/api";
import { BuiltinBrowserPanel } from "../src/features/builtin-browser/browser-panel";
import { backendChoices, backendRowsShown } from "../src/features/builtin-browser/backend-menu";
import {
  closeRemoteTab,
  openBrowserTab,
  refreshBrowserStatus,
  switchBrowserBackend,
} from "../src/features/builtin-browser/browser-actions";
import { browserState, dispatchBrowser } from "../src/features/builtin-browser/browser-store";
import { hostedStanding } from "../src/features/builtin-browser/hosted-panel";
import { S } from "../src/lib/strings";
import { apiError, json, stubFetch } from "./helpers/fetch";

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

const MACHINE = "machine-1";
const UNPAIRED: BrowserBackendInfo = {
  backend: "chrome",
  available: false,
  reason: "extension_not_paired",
};
const HOSTED: BrowserBackendInfo = {
  backend: "hosted",
  available: true,
  chrome: { path: "/usr/bin/chromium", running: false },
};
const NO_CHROME: BrowserBackendInfo = {
  backend: "hosted",
  available: false,
  reason: "hosted_no_chrome",
};
const DETAIL = "Running as root without --no-sandbox is not supported.";
const FAILED: BrowserBackendInfo = {
  backend: "hosted",
  available: false,
  reason: "hosted_launch_failed",
  detail: DETAIL,
  chrome: { path: "/usr/bin/chromium", running: false },
};

function status(
  backend: "builtin" | "chrome" | "hosted",
  backends: BrowserBackendInfo[],
): BuiltinBrowserStatus {
  const entry = backends.find((b) => b.backend === backend);
  return {
    available: entry?.available === true,
    ...(entry?.reason !== undefined ? { reason: entry.reason } : {}),
    ...(entry?.detail !== undefined ? { detail: entry.detail } : {}),
    backend,
    backends,
    tabs: [],
    activeTabId: null,
  };
}

const set = (s: BuiltinBrowserStatus, server: string | null = MACHINE) =>
  dispatchBrowser({ type: "status", status: s }, server);

const panel = (server: string | null = MACHINE) =>
  renderToStaticMarkup(createElement(BuiltinBrowserPanel, { active: true, server }));

const standingOf = (html: string): string | null =>
  /data-testid="hosted-browser-panel" data-standing="([^"]*)"/.exec(html)?.[1] ?? null;

beforeEach(() => {
  vi.stubGlobal("window", { location: { origin: "https://ph.example.com" } });
});
afterEach(() => {
  toasts.length = 0;
  dispatchBrowser({ type: "unreachable" }, MACHINE);
  dispatchBrowser({ type: "unreachable" });
});

describe("a machine's Browser panel", () => {
  it("shows the machine's browser, not this server's", () => {
    set(status("chrome", [UNPAIRED]), null);
    set(status("hosted", [UNPAIRED, HOSTED]));
    const html = panel();
    expect(standingOf(html)).toBe("ready");
    expect(html).toContain(S.builtinBrowser.hostedNoTabsTitle);
    expect(html).not.toContain("browser-chrome-surface");
    // This server's own panel is still the pairing steps of the user's Chrome.
    expect(panel(null)).toContain("browser-chrome-surface");
  });

  it("says there is no Chrome on the machine, and what to do about it", () => {
    // With none found the machine's default backend is chrome; the panel still speaks of its own.
    set(status("chrome", [UNPAIRED, NO_CHROME]));
    const html = panel();
    expect(standingOf(html)).toBe("no-chrome");
    expect(html).toContain(S.builtinBrowser.hostedNoChromeTitle);
    expect(html).toContain(S.builtinBrowser.hostedNoChromeBody);
    expect(html).toContain(S.builtinBrowser.hostedCheckAgain);
  });

  it("says Chrome did not start, with the line it printed", () => {
    set(status("hosted", [UNPAIRED, FAILED]));
    const html = panel();
    expect(standingOf(html)).toBe("launch-failed");
    expect(html).toContain(S.builtinBrowser.hostedLaunchFailedTitle);
    expect(html).toContain(DETAIL);
    expect(html).toContain(S.builtinBrowser.hostedTryAgain);
  });

  it("offers the switch where the machine's agents drive another browser", () => {
    set(status("chrome", [UNPAIRED, HOSTED]));
    const html = panel();
    expect(standingOf(html)).toBe("not-chosen");
    expect(html).toContain(S.builtinBrowser.useHosted);
  });

  it("waits for the first status, then says a machine offers no browser", () => {
    expect(hostedStanding(browserState(MACHINE), false)).toBe("reading");
    expect(hostedStanding(browserState(MACHINE), true)).toBe("not-offered");
    expect(panel()).toContain(S.builtinBrowser.hostedReading);
  });
});

describe("this server's panel on its own Chrome", () => {
  it("is the same surface once hosted is the backend chosen here", () => {
    set(status("hosted", [UNPAIRED, HOSTED]), null);
    expect(standingOf(panel(null))).toBe("ready");
  });
});

describe("the backend choice", () => {
  it("lists Chrome on this machine beside the others on this server", () => {
    set(status("hosted", [UNPAIRED, HOSTED]), null);
    expect(backendChoices(browserState())).toEqual(["chrome", "hosted"]);
    expect(backendRowsShown(browserState())).toBe(true);
    expect(panel(null)).toContain("hosted-browser-panel");
  });

  it("leaves the user's Chrome out on a machine, and with one backend left offers no choice", () => {
    set(status("hosted", [UNPAIRED, HOSTED]));
    expect(backendChoices(browserState(MACHINE), MACHINE)).toEqual(["hosted"]);
    expect(backendRowsShown(browserState(MACHINE), MACHINE)).toBe(false);
  });
});

describe("the panel's requests", () => {
  it("reads the status from the machine, into the machine's state", async () => {
    const hubBefore = browserState();
    const fetch = stubFetch(() => json(status("hosted", [UNPAIRED, HOSTED])));
    await refreshBrowserStatus(MACHINE);
    expect(fetch.requests.map((r) => [r.machine, r.path])).toEqual([
      [MACHINE, "/api/builtin-browser/status"],
    ]);
    expect(browserState(MACHINE).backend).toBe("hosted");
    expect(browserState()).toBe(hubBefore);
  });

  it("opens, closes and switches on the machine", async () => {
    set(status("chrome", [UNPAIRED, HOSTED]));
    const fetch = stubFetch((r) => {
      if (r.method === "PUT") return json({ backend: "hosted", choices: ["chrome", "hosted"] });
      if (r.method === "GET") return json(status("hosted", [UNPAIRED, HOSTED]));
      if (r.method === "DELETE") return new Response(null, { status: 204 });
      return json({
        tab: { id: 3, url: "", title: "", loading: false, canGoBack: false, canGoForward: false },
      });
    });
    expect(await switchBrowserBackend("hosted", MACHINE)).toBe(true);
    expect(toasts).toEqual([`success: ${S.builtinBrowser.switchedToHosted}`]);
    expect((await openBrowserTab("http://localhost:3000/", MACHINE))?.id).toBe(3);
    closeRemoteTab(3, "hosted", MACHINE);
    await Promise.resolve();
    expect(fetch.requests.map((r) => `${r.machine} ${r.method} ${r.path}`)).toEqual([
      `${MACHINE} PUT /api/builtin-browser/backend`,
      `${MACHINE} GET /api/builtin-browser/status`,
      `${MACHINE} POST /api/builtin-browser/tabs`,
      `${MACHINE} DELETE /api/builtin-browser/tabs/3`,
    ]);
  });

  it("re-reads the status when a tab could not be opened because the browser does not run", async () => {
    set(status("hosted", [UNPAIRED, HOSTED]));
    const fetch = stubFetch((r) =>
      r.method === "POST"
        ? apiError(503, "browser_unavailable")
        : json(status("hosted", [UNPAIRED, FAILED])),
    );
    expect(await openBrowserTab(undefined, MACHINE)).toBeNull();
    await vi.waitFor(() => expect(browserState(MACHINE).reason).toBe("hosted_launch_failed"));
    expect(browserState(MACHINE).detail).toBe(DETAIL);
    expect(fetch.requests.map((r) => r.method)).toEqual(["POST", "GET"]);
    expect(toasts).toHaveLength(1);
  });
});
