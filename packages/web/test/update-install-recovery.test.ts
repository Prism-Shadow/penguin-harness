// @vitest-environment jsdom
/**
 * Real desktop update dialog, actions and polling; only HTTP is replaced.
 * - An install error before or after POST acknowledgement shows Retry without the 90s wait.
 * - Retry can check and download the same release again.
 * - An old POST failure cannot cancel a newer installation attempt.
 * - Stale error snapshots do not cancel the current wait; snapshots without seq still work.
 * - Closing the dialog keeps polling while installation is pending.
 * - Duplicate clicks do not send another command, and timeout/POST failure permits retry.
 */
import { act, createElement as h } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopUpdateStatus } from "@prismshadow/penguin-server/api";
import { ADMIN_ME } from "./helpers/admin-settings";
import { apiError, json, stubFetch } from "./helpers/fetch";
import { button, hasButton, mount, unmountAll } from "./helpers/dom";

const failure = "Windows update verification failed. Download the update again.";

await import("../src/components/account/app-info-dialog");

async function fixture(withSeq = true) {
  vi.resetModules();
  localStorage.setItem("penguin.lang", "en");
  let status: DesktopUpdateStatus = {
    appVersion: "0.2.16",
    state: "downloaded",
    version: "99.0.0",
    ...(withSeq ? { seq: 10 } : {}),
  };
  const installs: Array<{
    resolve: (value: Response) => void;
    reject: (reason: Error) => void;
  }> = [];
  const fetch = stubFetch((request) => {
    if (request.path === "/api/me") {
      return json({ ...ADMIN_ME, desktopMode: true, sessionVia: "desktop" });
    }
    if (request.path === "/api/desktop/update") return json({ status });
    if (request.path === "/api/desktop/update/install") {
      return new Promise<Response>((resolve, reject) => installs.push({ resolve, reject }));
    }
    if (request.path === "/api/desktop/update/check") {
      status = {
        appVersion: "0.2.16",
        state: "available",
        version: "99.0.0",
        seq: (status.seq ?? 10) + 1,
      };
      return json({}, 202);
    }
    if (request.path === "/api/desktop/update/download") {
      status = { ...status, state: "downloaded", seq: (status.seq ?? 10) + 1 };
      return json({}, 202);
    }
    return apiError(404, "not_found");
  });
  const { AuthProvider } = await import("../src/state/auth");
  const { LocaleProvider } = await import("../src/state/locale");
  const { AppInfoDialog } = await import("../src/components/account/app-info-dialog");
  const actions = await import("../src/lib/use-update-flow");
  const desktop = await import("../src/lib/use-desktop-update");
  vi.useFakeTimers();
  await mount(h(LocaleProvider, null, h(AuthProvider, null, h(AppInfoDialog))));
  await act(async () => {
    actions.openAppInfo();
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(hasButton("Restart and update")).toBe(true);
  const advance = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  const refresh = async () => {
    await act(async () => {
      desktop.refreshDesktopUpdate();
      await vi.advanceTimersByTimeAsync(0);
    });
  };
  const press = async (name: string) => {
    await act(async () => {
      button(name).click();
    });
  };
  const acknowledge = async (index = installs.length - 1) => {
    await act(async () => {
      installs[index]!.resolve(json({}, 202));
    });
  };
  const invalidate = async (seq?: number) => {
    status = {
      appVersion: "0.2.16",
      state: "error",
      message: failure,
      ...(withSeq ? { seq: seq ?? (status.seq ?? 10) + 1 } : {}),
    };
    await refresh();
  };
  return {
    actions,
    desktop,
    fetch,
    installs,
    advance,
    refresh,
    press,
    acknowledge,
    invalidate,
    downloadAgain: async () => {
      await press("Retry");
      expect(hasButton("Download and update")).toBe(true);
      await press("Download and update");
      expect(hasButton("Restart and update")).toBe(true);
    },
  };
}

afterEach(async () => {
  await unmountAll();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("desktop installation failure in the web dialog", () => {
  it.each(["before", "after"] as const)(
    "shows the error and Retry when verification fails %s the POST response",
    async (order) => {
      const f = await fixture();
      await f.press("Restart and update");
      expect(document.body.textContent).toContain("The app is about to restart.");
      expect(hasButton("Retry")).toBe(false);
      if (order === "after") await f.acknowledge();
      await f.invalidate();
      expect(document.body.textContent).toContain(failure);
      expect(hasButton("Retry")).toBe(true);
      expect(document.body.textContent).not.toContain("The app is about to restart.");
      if (order === "before") await f.acknowledge();
      expect(hasButton("Retry")).toBe(true);
      await f.downloadAgain();
    },
  );

  it("does not let an old POST failure cancel a newer install attempt", async () => {
    const f = await fixture();
    await f.press("Restart and update");
    await f.invalidate();
    await f.downloadAgain();
    await f.press("Restart and update");
    expect(f.installs).toHaveLength(2);
    await act(async () => {
      f.installs[0]!.reject(new Error("late HTTP failure"));
    });
    expect(document.body.textContent).toContain("The app is about to restart.");
    expect(hasButton("Retry")).toBe(false);
    await f.acknowledge(1);
    await f.invalidate();
    expect(hasButton("Retry")).toBe(true);
  });

  it("ignores a stale error but recovers on a newer failure snapshot", async () => {
    const f = await fixture();
    await f.press("Restart and update");
    await f.acknowledge();
    await f.invalidate(9);
    expect(hasButton("Retry")).toBe(false);
    expect(document.body.textContent).toContain("The app is about to restart.");
    await f.invalidate(11);
    expect(hasButton("Retry")).toBe(true);
  });

  it("recovers when an older shell publishes no sequence number", async () => {
    const f = await fixture(false);
    await f.press("Restart and update");
    await f.acknowledge();
    await f.invalidate();
    expect(document.body.textContent).toContain(failure);
    expect(hasButton("Retry")).toBe(true);
  });

  it("keeps polling an installation after the dialog closes", async () => {
    const f = await fixture();
    await f.press("Restart and update");
    await f.acknowledge();
    await act(async () => {
      f.actions.closeAppInfo();
    });
    const before = f.fetch.requests.filter((r) => r.path === "/api/desktop/update").length;
    // Change the server without refreshing: only the owner's interval can observe it.
    f.fetch.answer((request) => {
      if (request.path === "/api/desktop/update") {
        return json({
          status: { appVersion: "0.2.16", state: "error", seq: 11, message: failure },
        });
      }
      return apiError(404, "not_found");
    });
    await f.advance(8_000);
    expect(f.fetch.requests.filter((r) => r.path === "/api/desktop/update").length).toBeGreaterThan(
      before,
    );
    expect(f.desktop.getDesktopUpdateStatus()?.state).toBe("error");
    await act(async () => {
      f.actions.openAppInfo();
    });
    expect(hasButton("Retry")).toBe(true);
  });

  it("coalesces duplicate commands and allows another attempt after restart timeout", async () => {
    const f = await fixture();
    await f.press("Restart and update");
    await act(async () => {
      void f.actions.installUpdate();
    });
    expect(f.installs).toHaveLength(1);
    await f.acknowledge();
    await f.advance(90_000);
    expect(hasButton("Restart and update")).toBe(true);
    await f.press("Restart and update");
    expect(f.installs).toHaveLength(2);
    await f.acknowledge();
  });

  it("restores the install action after an HTTP rejection", async () => {
    const f = await fixture();
    await f.press("Restart and update");
    await act(async () => {
      f.installs[0]!.reject(new Error("connection refused"));
    });
    expect(hasButton("Restart and update")).toBe(true);
    await f.press("Restart and update");
    expect(f.installs).toHaveLength(2);
    await f.acknowledge();
  });
});
