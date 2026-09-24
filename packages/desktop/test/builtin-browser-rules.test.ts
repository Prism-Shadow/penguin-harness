import { describe, expect, it } from "vitest";
import {
  BUILTIN_BROWSER_PARTITION,
  GUEST_MENU_LABELS,
  clearDataPlan,
  guestContextMenu,
  hardenGuestPreferences,
  isGrantedPermission,
  isOpenableUrl,
  mayAttachGuest,
  mayNavigate,
  parseBrowserCommand,
  pickFavicon,
  plainChromeUserAgent,
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

  it("speaks the Web App's language", () => {
    const zh = guestContextMenu({ ...base, locale: "zh" });
    expect(zh.find((item) => item.action === "inspect")?.label).toBe(GUEST_MENU_LABELS.zh.inspect);
    for (const locale of ["en", "zh"] as const) {
      for (const label of Object.values(GUEST_MENU_LABELS[locale])) expect(label).not.toBe("");
    }
  });
});
