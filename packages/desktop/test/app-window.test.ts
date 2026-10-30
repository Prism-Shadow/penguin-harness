/**
 * The shell's half of New Window: the frame it reads off the port, and the window it opens.
 *
 * - Only the open-window frame is one; every other frame is left to the handlers after it.
 * - The window has no Node and no <webview>, and none of the options a page could hide it with.
 * - It is guarded before it loads, and loads the App's front page; before the server has an
 *   origin nothing is created.
 */
import { describe, expect, it, vi } from "vitest";
import { appWindowOptions, openAppWindow, parseOpenWindowRequest } from "../src/app-window.js";
import { APP_WINDOW_OPTIONS } from "../src/util.js";

describe("parseOpenWindowRequest", () => {
  it("recognizes the open-window frame and nothing else", () => {
    expect(parseOpenWindowRequest({ type: "desktop-open-window" })).toBe(true);
    for (const frame of [
      null,
      undefined,
      "desktop-open-window",
      {},
      { type: "desktop-open-privacy-settings", pane: "files" },
      { type: "desktop-tray-command", showTrayIcon: true },
    ]) {
      expect(parseOpenWindowRequest(frame), JSON.stringify(frame)).toBe(false);
    }
  });
});

describe("appWindowOptions", () => {
  it("is as hardened as a window a page opens, and cannot be hidden", () => {
    const options = appWindowOptions("/icons/app.png");
    expect(options.webPreferences).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    });
    expect(options).toMatchObject(APP_WINDOW_OPTIONS);
    expect(options.icon).toBe("/icons/app.png");
    expect(appWindowOptions(null)).not.toHaveProperty("icon");
  });
});

describe("openAppWindow", () => {
  function deps(origin: string | null) {
    const calls: string[] = [];
    return {
      calls,
      log: vi.fn(),
      deps: {
        origin,
        iconPath: null,
        create: () => {
          calls.push("create");
          return { id: 1 };
        },
        guard: () => {
          calls.push("guard");
        },
        load: (_window: { id: number }, url: string) => {
          calls.push(`load ${url}`);
          return Promise.resolve();
        },
      },
    };
  }

  it("guards the window, then loads the front page", () => {
    const { calls, log, deps: d } = deps("http://127.0.0.1:4100");
    expect(openAppWindow({ ...d, log })).toEqual({ id: 1 });
    expect(calls).toEqual(["create", "guard", "load http://127.0.0.1:4100/"]);
    expect(log).not.toHaveBeenCalled();
  });

  it("opens nothing before the server has an origin", () => {
    const { calls, log, deps: d } = deps(null);
    expect(openAppWindow({ ...d, log })).toBeNull();
    expect(calls).toEqual([]);
    expect(log).toHaveBeenCalledOnce();
  });

  it("logs a window that does not load", async () => {
    const { log, deps: d } = deps("http://127.0.0.1:4100");
    openAppWindow({ ...d, load: () => Promise.reject(new Error("ERR_FAILED")), log });
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("ERR_FAILED"));
  });
});
