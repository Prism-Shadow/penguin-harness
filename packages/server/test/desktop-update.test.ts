/**
 * Client-update relay: the /api/desktop/update routes (shell-window sessions only), the
 * DesktopService store/forward pair behind them, and the message-port glue.
 *
 * The session gate is pinned in both directions like the change-password one it
 * mirrors: a desktop-via session may read and command, a password-via session against
 * the same desktop-mode server gets 403 — its holder may be on another machine and
 * must not restart this one's GUI app.
 */
import { describe, expect, it } from "vitest";
import { createTestApp, loginAdmin } from "./helpers.js";
import type {
  DesktopUpdateStatus,
  DesktopUpdateStatusResponse,
  ErrorBody,
} from "../src/api/types.js";
import { DesktopService } from "../src/services/desktop-service.js";
import {
  parseUpdaterStatusMessage,
  shellPortOf,
  wireShellUpdatePort,
} from "../src/services/desktop-update-port.js";
import type { ShellPort } from "../src/services/desktop-update-port.js";

const TOKEN = "test-desktop-token";

function desktopApp() {
  return createTestApp({ config: { desktopToken: TOKEN } });
}

/** Redeems the one-shot desktop-login for a `sessionVia: "desktop"` cookie. */
async function desktopCookie(app: Awaited<ReturnType<typeof desktopApp>>["app"]): Promise<string> {
  const res = await app.request(`/api/auth/desktop-login?token=${TOKEN}`);
  expect(res.status).toBe(302);
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

const STATUS: DesktopUpdateStatus = { appVersion: "0.2.3", state: "downloaded", version: "0.3.0" };

describe("GET /api/desktop/update", () => {
  it("serves null before the shell's first push, then the stored snapshot", async () => {
    const t = await desktopApp();
    try {
      const cookie = await desktopCookie(t.app);
      const before = await t.app.request("/api/desktop/update", { headers: { cookie } });
      expect(before.status).toBe(200);
      expect((await before.json()) as DesktopUpdateStatusResponse).toEqual({ status: null });

      t.deps.desktop!.setUpdateStatus(STATUS);
      const after = await t.app.request("/api/desktop/update", { headers: { cookie } });
      expect((await after.json()) as DesktopUpdateStatusResponse).toEqual({ status: STATUS });
    } finally {
      await t.cleanup();
    }
  });

  it("answers 403 desktop_shell_only to a password-established session", async () => {
    const t = await desktopApp();
    try {
      const admin = await loginAdmin(t.app);
      const res = await t.app.request("/api/desktop/update", {
        headers: { cookie: admin.cookie },
      });
      expect(res.status).toBe(403);
      expect(((await res.json()) as ErrorBody).error.code).toBe("desktop_shell_only");
    } finally {
      await t.cleanup();
    }
  });

  it("does not exist outside desktop mode", async () => {
    const t = await createTestApp();
    try {
      const admin = await loginAdmin(t.app);
      const res = await t.app.request("/api/desktop/update", {
        headers: { cookie: admin.cookie },
      });
      expect(res.status).toBe(404);
    } finally {
      await t.cleanup();
    }
  });
});

describe("POST /api/desktop/update/{check,install}", () => {
  it("forwards to the registered shell sender and answers 202", async () => {
    const t = await desktopApp();
    try {
      const cookie = await desktopCookie(t.app);
      const actions: string[] = [];
      t.deps.desktop!.onUpdateCommand((action) => actions.push(action));

      const check = await t.app.request("/api/desktop/update/check", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: "{}",
      });
      expect(check.status).toBe(202);
      const install = await t.app.request("/api/desktop/update/install", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: "{}",
      });
      expect(install.status).toBe(202);
      expect(actions).toEqual(["check", "install"]);
    } finally {
      await t.cleanup();
    }
  });

  it("answers 503 shell_unreachable while no port is wired", async () => {
    const t = await desktopApp();
    try {
      const cookie = await desktopCookie(t.app);
      const res = await t.app.request("/api/desktop/update/check", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(503);
      expect(((await res.json()) as ErrorBody).error.code).toBe("shell_unreachable");
    } finally {
      await t.cleanup();
    }
  });
});

describe("desktop-update-port", () => {
  it("parses only well-formed status frames", () => {
    expect(parseUpdaterStatusMessage({ type: "desktop-updater-status", status: STATUS })).toEqual(
      STATUS,
    );
    for (const data of [
      null,
      "status",
      {},
      { type: "desktop-updater-status" },
      { type: "desktop-updater-status", status: null },
      { type: "desktop-updater-status", status: { state: "downloaded" } }, // no appVersion
      { type: "desktop-updater-status", status: { appVersion: "1", state: "resting" } },
      { type: "desktop-updater-command", status: STATUS },
    ]) {
      expect(parseUpdaterStatusMessage(data)).toBeNull();
    }
  });

  it("stores pushed frames and posts commands through a wired port", () => {
    const desktop = new DesktopService("t");
    const posted: unknown[] = [];
    let onMessage: ((e: { data: unknown }) => void) | undefined;
    const port: ShellPort = {
      on: (_event, listener) => {
        onMessage = listener;
      },
      postMessage: (message) => posted.push(message),
    };
    wireShellUpdatePort(desktop, port);

    onMessage!({ data: { type: "desktop-updater-status", status: STATUS } });
    expect(desktop.getUpdateStatus()).toEqual(STATUS);
    onMessage!({ data: { garbage: true } });
    expect(desktop.getUpdateStatus()).toEqual(STATUS);

    expect(desktop.requestUpdateCommand("check")).toBe(true);
    expect(posted).toEqual([{ type: "desktop-updater-command", action: "check" }]);
  });

  it("finds no shell port on a plain Node process without parentPort", () => {
    expect(shellPortOf(process)).toBeNull();
  });
});
