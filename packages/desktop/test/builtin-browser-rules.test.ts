/**
 * Guests attach only to browser storage with hardened preferences. Project partitions keep
 * their own profile even when an element supplies a conflicting webpreferences partition;
 * cookie import and clear preserve the selected profile and refuse arbitrary app partitions.
 *
 * Google sign-in sees Electron's own user agent, every other page Chrome's:
 * - Given a tab whose main frame goes to accounts.google.com or accounts.youtube.com, then it
 *   presents Electron's own user agent, unmodified.
 * - Given any other page (Google's own services, look-alike hosts, a sign-in address in a
 *   query), then it presents Chrome's: Electron's never leaks there.
 * - Given a tab on the sign-in, when its main frame leaves for another site, then it presents
 *   Chrome's again.
 * - Given a main-frame request that still names the user agent its tab just left, then it goes
 *   out with the tab's, and its client hints and every other header go unchanged.
 * - Given a request that already names its tab's user agent, or names neither of the guest's
 *   (a DevTools override), then nothing changes.
 * - Given a main-frame redirect across the sign-in boundary, either way, then the navigation
 *   starts over at the target; a redirect that keeps the user agent, one in a frame, one to a
 *   non-web address, or one past the restart limit is followed as it comes.
 */
import { describe, expect, it } from "vitest";
import {
  BUILTIN_BROWSER_PARTITION,
  MAX_FAVICON_URL_CHARS,
  clearDataPlan,
  focusGuestScript,
  MAX_SIGN_IN_RESTARTS,
  guestContextMenu,
  guestUserAgents,
  hardenGuestPreferences,
  isGrantedPermission,
  isOpenableUrl,
  mayAttachGuest,
  mayNavigate,
  navigationRequestHeaders,
  parseBrowserCommand,
  pickFavicon,
  plainChromeUserAgent,
  privateMemoryKB,
  procStatusPrivateKB,
  restartsAtRedirect,
  tabLoads,
  typesIntoGuest,
  userAgentForPage,
} from "../src/builtin-browser-rules.js";
import type { GuestMenuInput } from "../src/builtin-browser-rules.js";

describe("mayAttachGuest", () => {
  it("admits the browser's partition with a web or blank start page", () => {
    for (const src of [
      "https://example.com/",
      "http://localhost:3000/x",
      "about:blank",
      "",
      undefined,
    ]) {
      expect(mayAttachGuest({ partition: BUILTIN_BROWSER_PARTITION, src })).toBe(true);
    }
  });

  it("refuses any other partition, and non-web start pages", () => {
    expect(mayAttachGuest({ partition: "persist:other", src: "https://example.com/" })).toBe(false);
    expect(mayAttachGuest({ src: "https://example.com/" })).toBe(false);
    for (const src of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "chrome://gpu",
      "data:text/html,x",
    ]) {
      expect(mayAttachGuest({ partition: BUILTIN_BROWSER_PARTITION, src })).toBe(false);
    }
  });
});

describe("hardenGuestPreferences", () => {
  it("forces the hardened shape over whatever the element asked for", () => {
    const prefs: Record<string, unknown> = {
      partition: "persist:elsewhere",
      preload: "/tmp/evil.js",
      nodeIntegration: true,
      nodeIntegrationInSubFrames: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: false,
      webviewTag: true,
      disablePopups: true,
      transparent: true,
      plugins: true,
    };
    hardenGuestPreferences(prefs);
    expect(prefs).toEqual({
      partition: BUILTIN_BROWSER_PARTITION,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      backgroundThrottling: false,
      // Popups reach the window-open handler (which denies each one into an open request).
      disablePopups: false,
      // An opaque page: the app's surface never shows through one without a background.
      transparent: false,
      // Untouched: not a security preference.
      plugins: true,
    });
  });
});

describe("navigation and popups", () => {
  it("lets a guest's main frame go to web, blank, data and blob pages only", () => {
    for (const url of [
      "https://a.test/",
      "http://a.test/",
      "about:blank",
      "data:text/html,hi",
      "blob:https://a.test/1",
    ]) {
      expect(mayNavigate(url)).toBe(true);
    }
    for (const url of [
      "file:///etc/hosts",
      "chrome://settings",
      "mailto:a@b.c",
      "javascript:void 0",
      "zoommtg://x",
      "nonsense",
    ]) {
      expect(mayNavigate(url)).toBe(false);
    }
  });

  it("turns only web popups into tabs", () => {
    expect(isOpenableUrl("https://a.test/")).toBe(true);
    expect(isOpenableUrl("HTTP://A.TEST/")).toBe(true);
    expect(isOpenableUrl("about:blank")).toBe(false);
    expect(isOpenableUrl("file:///x")).toBe(false);
  });

  it("keeps the first favicon small enough to ride a tab event", () => {
    expect(pickFavicon([])).toBeUndefined();
    expect(pickFavicon(["https://a.test/favicon.ico"])).toBe("https://a.test/favicon.ico");
    const huge = `data:image/png;base64,${"A".repeat(20_000)}`;
    expect(pickFavicon([huge, "https://a.test/i.png"])).toBe("https://a.test/i.png");
    expect(pickFavicon([huge])).toBeUndefined();
  });

  it("takes a data: icon up to 4 KB and an address up to 2 KB", () => {
    const data = (n: number) => `data:image/png;base64,${"A".repeat(n)}`;
    expect(pickFavicon([data(3_000)])).toBe(data(3_000));
    expect(pickFavicon([data(5_000)])).toBeUndefined();
    const long = `https://a.test/${"p".repeat(MAX_FAVICON_URL_CHARS)}.ico`;
    expect(pickFavicon([long, "https://a.test/f.ico"])).toBe("https://a.test/f.ico");
  });
});

describe("plainChromeUserAgent", () => {
  it("drops Electron's token and the app's", () => {
    expect(
      plainChromeUserAgent(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) PenguinHarness/0.2.13 Chrome/140.0.7339.80 Electron/43.2.0 Safari/537.36",
      ),
    ).toBe(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.80 Safari/537.36",
    );
  });

  it("copes with an app name that has a space in it", () => {
    expect(
      plainChromeUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) PenguinHarness Dev/0.2.13 Chrome/140.0.0.0 Electron/43.2.0 Safari/537.36",
      ),
    ).toBe(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    );
  });

  it("leaves a plain Chrome user agent alone", () => {
    const chrome =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
    expect(plainChromeUserAgent(chrome)).toBe(chrome);
  });
});

describe("Google sign-in's user agent", () => {
  const electron =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) PenguinHarness/0.2.18 Chrome/150.0.7712.40 Electron/43.7.6 Safari/537.36";
  const chrome =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7712.40 Safari/537.36";
  const agents = guestUserAgents(electron);
  /** A main-frame request's headers as Chromium wrote them, client hints included. */
  const sent = (userAgent: string) => ({
    "User-Agent": userAgent,
    "sec-ch-ua": '"Chromium";v="150", "Not?A_Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "Accept-Language": "en-US",
  });

  it("shows Electron's own user agent, unmodified, on Google's sign-in pages", () => {
    for (const url of [
      "https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fmail.google.com",
      "https://ACCOUNTS.GOOGLE.COM/ServiceLogin",
      "http://accounts.google.com/",
      "https://accounts.youtube.com/accounts/SetSID?ssdc=1",
    ]) {
      expect(userAgentForPage(url, agents)).toBe(electron);
    }
  });

  it("shows Chrome's everywhere else, Google's own services included", () => {
    for (const url of [
      "https://mail.google.com/mail/u/0/",
      "https://myaccount.google.com/",
      "https://www.google.com/search?q=accounts.google.com",
      "https://www.youtube.com/",
      "https://accounts.google.com.example.test/",
      "https://example.test/?next=https://accounts.google.com/",
      "https://web.whatsapp.com/",
      "about:blank",
      "not a url",
    ]) {
      expect(userAgentForPage(url, agents)).toBe(chrome);
    }
  });

  it("gives a tab Chrome's back once its main frame leaves the sign-in", () => {
    const walk = [
      "https://example.test/",
      "https://accounts.google.com/v3/signin/identifier",
      "https://accounts.youtube.com/accounts/SetSID",
      "https://accounts.google.com/CheckCookie",
      "https://mail.google.com/mail/u/0/",
    ];
    expect(walk.map((url) => userAgentForPage(url, agents))).toEqual([
      chrome,
      electron,
      electron,
      electron,
      chrome,
    ]);
  });

  it("sends a navigation with the user agent its tab switched to, leaving the client hints alone", () => {
    // Into the sign-in: written while the tab was still Chrome.
    expect(navigationRequestHeaders(sent(chrome), electron, agents)).toEqual({
      ...sent(chrome),
      "User-Agent": electron,
    });
    // Out of it: written while the tab was still Electron.
    expect(navigationRequestHeaders(sent(electron), chrome, agents)).toEqual({
      ...sent(electron),
      "User-Agent": chrome,
    });
    // Whatever the header's spelling.
    expect(navigationRequestHeaders({ "user-agent": chrome }, electron, agents)).toEqual({
      "user-agent": electron,
    });
  });

  it("leaves a request alone when it already names its tab's user agent, or neither of the guest's", () => {
    expect(navigationRequestHeaders(sent(chrome), chrome, agents)).toBeNull();
    expect(navigationRequestHeaders(sent(electron), electron, agents)).toBeNull();
    const emulated = sent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148");
    expect(navigationRequestHeaders(emulated, electron, agents)).toBeNull();
    expect(navigationRequestHeaders({ Accept: "text/html" }, electron, agents)).toBeNull();
  });

  it("starts a main-frame navigation over when a redirect crosses into or out of the sign-in", () => {
    const redirect = (url: string, tabUserAgent: string) =>
      restartsAtRedirect({ url, isMainFrame: true, tabUserAgent, restarts: 0 }, agents);
    // A site's "Sign in with Google" redirecting to Google, and Google's redirect back after it.
    expect(redirect("https://accounts.google.com/o/oauth2/v2/auth?client_id=x", chrome)).toBe(true);
    expect(redirect("https://app.example.test/callback?code=x", electron)).toBe(true);
    // Hops that keep the user agent go on as they are.
    expect(redirect("https://accounts.youtube.com/accounts/SetSID", electron)).toBe(false);
    expect(redirect("https://mail.google.com/mail/u/0/", chrome)).toBe(false);
  });

  it("follows a redirect in a frame, to a non-web address, or past the restart limit", () => {
    const into = { url: "https://accounts.google.com/ServiceLogin", tabUserAgent: chrome };
    expect(restartsAtRedirect({ ...into, isMainFrame: false, restarts: 0 }, agents)).toBe(false);
    expect(
      restartsAtRedirect(
        {
          url: "com.example.app:/oauth2redirect?code=x",
          isMainFrame: true,
          tabUserAgent: electron,
          restarts: 0,
        },
        agents,
      ),
    ).toBe(false);
    expect(
      restartsAtRedirect(
        { ...into, isMainFrame: true, restarts: MAX_SIGN_IN_RESTARTS - 1 },
        agents,
      ),
    ).toBe(true);
    expect(
      restartsAtRedirect({ ...into, isMainFrame: true, restarts: MAX_SIGN_IN_RESTARTS }, agents),
    ).toBe(false);
  });
});

describe("clearDataPlan", () => {
  it("maps the protocol's categories onto Electron's storage names", () => {
    expect(clearDataPlan(["cookies"])).toEqual({ storageData: ["cookies"], cache: false });
    expect(clearDataPlan(["cache"])).toEqual({ storageData: [], cache: true });
    const all = clearDataPlan(["cookies", "storage", "cache", "cookies"]);
    expect(all?.cache).toBe(true);
    expect(all?.storageData).toEqual([
      "cookies",
      "filesystem",
      "indexdb",
      "localstorage",
      "shadercache",
      "serviceworkers",
      "cachestorage",
    ]);
  });

  it("refuses an empty list or an unknown category", () => {
    expect(clearDataPlan([])).toBeNull();
    expect(clearDataPlan(["history"])).toBeNull();
    expect(clearDataPlan("cookies")).toBeNull();
  });
});

describe("isGrantedPermission", () => {
  it("grants what pages need to work and refuses what reaches the machine", () => {
    for (const p of ["fullscreen", "pointerLock", "clipboard-sanitized-write", "storage-access"]) {
      expect(isGrantedPermission(p)).toBe(true);
    }
    for (const p of [
      "media",
      "geolocation",
      "notifications",
      "openExternal",
      "clipboard-read",
      "display-capture",
      "midiSysex",
      "unknown",
    ]) {
      expect(isGrantedPermission(p)).toBe(false);
    }
  });
});

describe("parseBrowserCommand", () => {
  const frame = (command: unknown) => ({ type: "desktop-browser-command", id: "c1", command });

  it("ignores frames that are not browser commands", () => {
    expect(parseBrowserCommand(null)).toBeNull();
    expect(parseBrowserCommand("hello")).toBeNull();
    expect(parseBrowserCommand({ type: "desktop-updater-command", action: "check" })).toBeNull();
    // No id: there is nothing to answer.
    expect(
      parseBrowserCommand({ type: "desktop-browser-command", command: { op: "hello" } }),
    ).toBeNull();
  });

  it("reads each op", () => {
    expect(parseBrowserCommand(frame({ op: "hello" }))).toEqual({
      id: "c1",
      command: { op: "hello" },
    });
    expect(parseBrowserCommand(frame({ op: "tabs" }))).toEqual({
      id: "c1",
      command: { op: "tabs" },
    });
    expect(
      parseBrowserCommand(
        frame({ op: "cdp", tabId: 7, method: "Runtime.evaluate", params: { expression: "1" } }),
      ),
    ).toEqual({
      id: "c1",
      command: { op: "cdp", tabId: 7, method: "Runtime.evaluate", params: { expression: "1" } },
    });
    expect(parseBrowserCommand(frame({ op: "cdp", tabId: 7, method: "Page.reload" }))).toEqual({
      id: "c1",
      command: { op: "cdp", tabId: 7, method: "Page.reload" },
    });
    // The events it relays from then on: a list of names, or an empty one for none.
    const events = ["Page.javascriptDialogOpening"];
    expect(
      parseBrowserCommand(frame({ op: "cdp", tabId: 7, method: "Page.enable", events })),
    ).toEqual({ id: "c1", command: { op: "cdp", tabId: 7, method: "Page.enable", events } });
    expect(
      parseBrowserCommand(frame({ op: "cdp", tabId: 7, method: "Page.disable", events: [] })),
    ).toEqual({ id: "c1", command: { op: "cdp", tabId: 7, method: "Page.disable", events: [] } });
    const cookies = [{ url: "https://a.test/", name: "sid", value: "v", httpOnly: true }];
    expect(parseBrowserCommand(frame({ op: "set-cookies", cookies }))).toEqual({
      id: "c1",
      command: { op: "set-cookies", cookies },
    });
    expect(parseBrowserCommand(frame({ op: "clear-data", storages: ["cache"] }))).toEqual({
      id: "c1",
      command: { op: "clear-data", storages: ["cache"] },
    });
    expect(parseBrowserCommand(frame({ op: "throttle", tabIds: [3, 7] }))).toEqual({
      id: "c1",
      command: { op: "throttle", tabIds: [3, 7] },
    });
    expect(parseBrowserCommand(frame({ op: "throttle", tabIds: [] }))).toEqual({
      id: "c1",
      command: { op: "throttle", tabIds: [] },
    });
  });

  it("answers what it cannot run with an error rather than silence", () => {
    expect(parseBrowserCommand(frame({ op: "reboot" }))).toEqual({ id: "c1", error: "unknown_op" });
    expect(parseBrowserCommand(frame(undefined))).toEqual({ id: "c1", error: "bad_command" });
    expect(parseBrowserCommand(frame({ op: "cdp", tabId: "7", method: "x" }))).toEqual({
      id: "c1",
      error: "bad_command",
    });
    expect(parseBrowserCommand(frame({ op: "cdp", tabId: 7, method: "x", params: [1] }))).toEqual({
      id: "c1",
      error: "bad_command",
    });
    for (const events of ["Page.javascriptDialogOpening", [1], ["not an event"]]) {
      expect(parseBrowserCommand(frame({ op: "cdp", tabId: 7, method: "x", events }))).toEqual({
        id: "c1",
        error: "bad_command",
      });
    }
    expect(parseBrowserCommand(frame({ op: "set-cookies", cookies: [{ url: "x" }] }))).toEqual({
      id: "c1",
      error: "bad_command",
    });
    expect(parseBrowserCommand(frame({ op: "clear-data", storages: ["everything"] }))).toEqual({
      id: "c1",
      error: "bad_command",
    });
    for (const tabIds of [
      undefined,
      "3",
      [3.5],
      ["3"],
      Array.from({ length: 1001 }, (_, i) => i),
    ]) {
      expect(parseBrowserCommand(frame({ op: "throttle", tabIds }))).toEqual({
        id: "c1",
        error: "bad_command",
      });
    }
  });
});

describe("guestContextMenu", () => {
  const base: GuestMenuInput = {
    locale: "en",
    x: 10,
    y: 20,
    linkURL: "",
    srcURL: "",
    mediaType: "none",
    isEditable: false,
    selectionText: "",
    editFlags: { canCut: false, canCopy: false, canPaste: false, canSelectAll: true },
    canGoBack: true,
    canGoForward: false,
  };
  const shape = (input: Partial<GuestMenuInput>) =>
    guestContextMenu({ ...base, ...input }).map((item) => item.action ?? item.type);

  it("offers navigation on the page itself, then Inspect", () => {
    const menu = guestContextMenu(base);
    expect(menu.map((item) => item.action ?? item.type)).toEqual([
      "back",
      "forward",
      "reload",
      "separator",
      "inspect",
    ]);
    expect(menu.find((item) => item.action === "back")?.enabled).toBeUndefined();
    expect(menu.find((item) => item.action === "forward")?.enabled).toBe(false);
  });

  it("offers the link's entries on a link, and only copying for a non-web one", () => {
    expect(shape({ linkURL: "https://a.test/x" })).toEqual([
      "open-link",
      "copy-link",
      "separator",
      "inspect",
    ]);
    expect(shape({ linkURL: "mailto:a@b.c" })).toEqual(["copy-link", "separator", "inspect"]);
  });

  it("offers the image address on an image, beside its link", () => {
    expect(
      shape({ linkURL: "https://a.test/x", mediaType: "image", srcURL: "https://a.test/i.png" }),
    ).toEqual([
      "open-link",
      "copy-link",
      "separator",
      "copy-image-address",
      "separator",
      "inspect",
    ]);
  });

  it("offers the edit commands a field allows, and Copy over a selection", () => {
    expect(
      shape({
        isEditable: true,
        editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true },
      }),
    ).toEqual(["cut", "copy", "paste", "select-all", "separator", "inspect"]);
    expect(
      shape({
        isEditable: true,
        editFlags: { canCut: false, canCopy: false, canPaste: true, canSelectAll: false },
      }),
    ).toEqual(["paste", "separator", "inspect"]);
    expect(
      shape({
        selectionText: "hello",
        editFlags: { canCut: false, canCopy: true, canPaste: false, canSelectAll: true },
      }),
    ).toEqual(["copy", "separator", "inspect"]);
  });

  it("opens DevTools instead of inspecting when the click has no position", () => {
    expect(shape({ x: Number.NaN })).toEqual([
      "back",
      "forward",
      "reload",
      "separator",
      "devtools",
    ]);
  });

  it("speaks the Web App's language: the same entries, in other words", () => {
    const en = guestContextMenu({ ...base, locale: "en" });
    const zh = guestContextMenu({ ...base, locale: "zh" });
    expect(zh.map((item) => item.action ?? item.type)).toEqual(
      en.map((item) => item.action ?? item.type),
    );
    zh.forEach((item, i) => {
      if (item.action === undefined) return;
      expect(item.label, item.action).toBeTruthy();
      expect(item.label, item.action).not.toBe(en[i]!.label);
    });
  });
});

describe("load", () => {
  it("adds up each tab's processes, and counts a shared one once in the total", () => {
    const processes = [
      { pid: 10, memoryKB: 300_000, cpuPercent: 12.34 },
      { pid: 11, memoryKB: 50_000, cpuPercent: 1 },
      { pid: 20, memoryKB: 200_000, cpuPercent: 0 },
      // A cross-site frame's process both tabs use (an ad network's, say).
      { pid: 30, memoryKB: 40_000, cpuPercent: 2 },
      { pid: 99, memoryKB: 999_999, cpuPercent: 50 },
    ];
    expect(
      tabLoads(processes, [
        { tabId: 1, pids: [10, 11, 30, 10] },
        { tabId: 2, pids: [20, 30] },
        // A tab whose renderer the measurement no longer lists.
        { tabId: 3, pids: [40] },
      ]),
    ).toEqual({
      tabs: [
        { tabId: 1, memoryKB: 390_000, cpuPercent: 15.3 },
        { tabId: 2, memoryKB: 240_000, cpuPercent: 2 },
        { tabId: 3, memoryKB: 0, cpuPercent: 0 },
      ],
      totalKB: 590_000,
    });
    expect(tabLoads(processes, [])).toEqual({ tabs: [], totalKB: 0 });
  });

  it("reads Linux's private memory: anonymous pages plus swap", () => {
    const status =
      "Name:\telectron\nVmRSS:\t  812004 kB\nRssAnon:\t  301248 kB\nRssFile:\t  98000 kB\nVmSwap:\t    2048 kB\n";
    expect(procStatusPrivateKB(status)).toBe(303_296);
    expect(procStatusPrivateKB("RssAnon:\t 100 kB\n")).toBe(100);
    expect(procStatusPrivateKB("VmRSS:\t 100 kB\n")).toBeNull();
  });

  it("measures a process by what it holds alone: private memory, not its working set", () => {
    const memory = { workingSetSize: 812_004, privateBytes: 250_000 };
    const status = "RssAnon:\t  301248 kB\nVmSwap:\t 0 kB\n";
    expect(privateMemoryKB("linux", memory, status)).toBe(301_248);
    // Gone before it could be read: its working set is all there is.
    expect(privateMemoryKB("linux", memory, null)).toBe(812_004);
    expect(privateMemoryKB("win32", memory, null)).toBe(250_000);
    expect(privateMemoryKB("win32", { workingSetSize: 812_004 }, null)).toBe(812_004);
    expect(privateMemoryKB("darwin", memory, null)).toBe(812_004);
  });
});

describe("Project partitions", () => {
  it("keeps an admitted Project partition through preference hardening", () => {
    const partition = "persist:penguin-browser-project-" + "a".repeat(64);
    expect(mayAttachGuest({ partition, src: "https://example.test" })).toBe(true);
    const prefs: Record<string, unknown> = {
      partition: "persist:elsewhere",
      nodeIntegration: true,
    };
    hardenGuestPreferences(prefs, partition);
    expect(prefs.partition).toBe(partition);
    expect(prefs.nodeIntegration).toBe(false);
  });

  it("targets cookie writes and clearing only at valid browser partitions", () => {
    const partition = "persist:penguin-browser-project-" + "b".repeat(64);
    for (const command of [
      { op: "set-cookies", cookies: [] },
      { op: "clear-data", storages: ["cookies"] },
    ]) {
      const parsed = parseBrowserCommand({
        type: "desktop-browser-command",
        id: "1",
        command: { ...command, partition },
      });
      expect(parsed).toMatchObject({ command: { ...command, partition } });
      for (const foreign of ["", "persist:app", "persist:penguin-browser-project-../app"]) {
        expect(
          parseBrowserCommand({
            type: "desktop-browser-command",
            id: "1",
            command: { ...command, partition: foreign },
          }),
        ).toEqual({ id: "1", error: "bad_command" });
      }
    }
  });
});

describe("keyboard focus before typing", () => {
  /** The embedder's page as the focus script sees it: its <webview> elements and its focus. */
  function embedder(views: Array<{ id: number | null; focusable?: boolean }>) {
    const focusCalls: Array<{ id: number | null; options: unknown }> = [];
    const page = { activeElement: null as unknown, querySelectorAll: (_s: string) => elements };
    const elements = views.map((view) => {
      const element = {
        getWebContentsId(): number {
          if (view.id === null) throw new Error("The webview is not attached yet.");
          return view.id;
        },
        focus(options: unknown) {
          focusCalls.push({ id: view.id, options });
          if (view.focusable !== false) page.activeElement = element;
        },
      };
      return element;
    });
    const run = (script: string): unknown =>
      (new Function("document", `return ${script};`) as (d: unknown) => unknown)(page);
    return { page, elements, focusCalls, run };
  }

  it("waits for focus only before commands that type, not before mouse input or scripts", () => {
    for (const method of [
      "Input.insertText",
      "Input.dispatchKeyEvent",
      "Input.imeSetComposition",
    ]) {
      expect(typesIntoGuest(method)).toBe(true);
    }
    for (const method of ["Input.dispatchMouseEvent", "Runtime.evaluate", "Page.navigate"]) {
      expect(typesIntoGuest(method)).toBe(false);
    }
  });

  it("focuses the guest's own element without scrolling, past one not attached yet", () => {
    const page = embedder([{ id: null }, { id: 7 }, { id: 9 }]);
    expect(page.run(focusGuestScript(9))).toBe(true);
    expect(page.focusCalls).toEqual([{ id: 9, options: { preventScroll: true } }]);
    expect(page.page.activeElement).toBe(page.elements[2]);
  });

  it("leaves a guest that already holds focus alone", () => {
    const page = embedder([{ id: 9 }]);
    page.page.activeElement = page.elements[0];
    expect(page.run(focusGuestScript(9))).toBe(true);
    expect(page.focusCalls).toEqual([]);
  });

  it("reports a guest with no element, or one whose element does not take focus", () => {
    expect(embedder([{ id: 7 }]).run(focusGuestScript(9))).toBe(false);
    const refusing = embedder([{ id: 9, focusable: false }]);
    expect(refusing.run(focusGuestScript(9))).toBe(false);
  });

  it("builds the script only for a real webContents id", () => {
    expect(() => focusGuestScript(Number.NaN)).toThrow("bad_command");
    expect(() => focusGuestScript(1.5)).toThrow("bad_command");
  });
});
