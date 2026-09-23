/**
 * The Browser tab's pure parts: the theme as a page is offered it, the address a page's
 * reported location stands for, the tab's remembered address, and its place in the dock.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { browserThemeMessage } from "../src/features/browser/browser-theme";
import { addressOnSite } from "../src/features/browser/browser-tab";

describe("the theme a page is offered", () => {
  it("carries the app's resolved tokens under names of its own — never Tailwind's", () => {
    const message = browserThemeMessage({
      dark: true,
      fontSize: "16px",
      vars: {
        "--font-app-sans": "Inter, sans-serif",
        "--accent-bg": "#2563eb",
        "--color-gray-900": "#0d0d0d",
      },
    });
    expect(message).toMatchObject({
      type: "penguin:browser:theme",
      dark: true,
      vars: {
        "--penguin-font-sans": "Inter, sans-serif",
        "--penguin-accent-bg": "#2563eb",
        "--penguin-color-gray-900": "#0d0d0d",
      },
    });
    expect(Object.keys(message.vars).every((name) => name.startsWith("--penguin-"))).toBe(true);
  });

  it("resolves the roles a page writes with for the scheme in force", () => {
    const vars = {
      "--color-gray-50": "#f9fafb",
      "--color-gray-100": "#f3f4f6",
      "--color-gray-900": "#0d0d0d",
      "--color-gray-950": "#000000",
    };
    const light = browserThemeMessage({ dark: false, fontSize: "16px", vars }).vars;
    expect(light["--penguin-bg"]).toBe("#ffffff");
    expect(light["--penguin-fg"]).toBe("#0d0d0d");
    expect(light["--penguin-surface"]).toBe("#f9fafb");
    const dark = browserThemeMessage({ dark: true, fontSize: "16px", vars }).vars;
    expect(dark["--penguin-bg"]).toBe("#000000");
    expect(dark["--penguin-fg"]).toBe("#f3f4f6");
    // A step the app did not resolve is left out rather than sent empty.
    expect(dark["--penguin-border"]).toBeUndefined();
  });
});

describe("addressOnSite", () => {
  const shown = {
    address: "http://localhost:3000/start",
    origin: "http://abcdefghijklmnopqrstuvwxyz.localhost:7364",
  };

  it("reads a location on the tab's host as the site's own address", () => {
    expect(addressOnSite(shown, `${shown.origin}/docs?q=1#top`)).toBe(
      "http://localhost:3000/docs?q=1#top",
    );
  });

  it("ignores a location anywhere else", () => {
    expect(addressOnSite(shown, "http://localhost:7364/chat")).toBeNull();
    expect(addressOnSite(shown, "https://example.com/")).toBeNull();
    expect(addressOnSite(shown, "not a url")).toBeNull();
  });
});

describe("a Browser tab in the dock", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
    vi.resetModules();
  });

  it("remembers its address until it is closed", async () => {
    const tabs = await import("../src/features/browser/browser-tabs");
    const id = tabs.newBrowserTab("localhost:3000");
    expect(tabs.browserAddress(id)).toBe("localhost:3000");
    tabs.setBrowserAddress(id, "http://localhost:3000/docs");
    expect(tabs.browserAddress(id)).toBe("http://localhost:3000/docs");
    expect(tabs.browserAddress("someone-else")).toBe("");
    tabs.forgetBrowserTab(id);
    expect(tabs.browserAddress(id)).toBe("");
  });

  it("comes back to the dock it left after a detach, even into another conversation, and not twice", async () => {
    const dock = await import("../src/features/dock/dock-state");
    dock.setDockScope("s1");
    dock.addBrowserTab("b1", "bottom");
    dock.removeTab("browser:b1"); // detached: the page lives in a tab of its own now
    expect(dock.dockTabs("bottom")).toEqual([]);
    dock.setDockScope("s2"); // the user moved on
    dock.restoreBrowserTab("s1", "b1", "bottom");
    expect(dock.dockTabs("bottom")).toEqual([]); // not here…
    dock.setDockScope("s1");
    expect(dock.dockTabs("bottom").map(dock.tabKey)).toEqual(["browser:b1"]); // …there
    dock.restoreBrowserTab("s1", "b1", "right");
    expect(dock.dockTabs("right")).toEqual([]);
    expect(dock.dockTabs("bottom").map(dock.tabKey)).toEqual(["browser:b1"]);
  });

  it("opens in the right dock, may be many, and comes back from storage", async () => {
    const dock = await import("../src/features/dock/dock-state");
    dock.setDockScope("s1");
    dock.addBrowserTab("b1");
    dock.addBrowserTab("b2");
    expect(dock.dockTabs("right").map(dock.tabKey)).toEqual(["browser:b1", "browser:b2"]);
    expect(dock.dockActiveKey("right")).toBe("browser:b2");

    vi.resetModules();
    const reloaded = await import("../src/features/dock/dock-state");
    reloaded.setDockScope("s1");
    expect(reloaded.dockTabs("right").map(reloaded.tabKey)).toEqual(["browser:b1", "browser:b2"]);
  });
});
