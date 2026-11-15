/**
 * The tray-icon preference relay: the /api/desktop/tray routes (the shell window's sessions
 * only), and the shell port they ride.
 *
 * - The tray state reads as null before the shell's first push, then as what it pushed.
 * - A PUT forwards the switch to the shell and answers 202; a field it cannot read, or a
 *   request that asks for nothing, is refused and reaches no shell.
 * - A password session against the same desktop server gets 403 (its holder may be on another
 *   machine, and must not reach into the chrome of a window it is not looking at); with no
 *   shell wired the PUT answers 503; a plain server has no such route.
 * - Only a well-formed tray frame is read, defaulting a missing or unknown language to English;
 *   the updater's frames on the same port are not tray frames.
 * - Tray pushes and tray commands share one port with the updater's, neither disturbing the other.
 */
import { describe, expect, it } from "vitest";
import { createDesktopApp, createTestApp, desktopLoginCookie, loginAdmin } from "./helpers.js";
import type { DesktopTrayPatch, DesktopTrayStatusResponse, ErrorBody } from "../src/api/types.js";
import { DesktopService } from "../src/services/desktop-service.js";
import {
  parseTrayStatusMessage,
  wireShellUpdatePort,
} from "../src/services/desktop-update-port.js";
import { FakePort } from "./builtin-browser/fake-shell.js";

const put = (cookie: string, body: string) => ({
  method: "PUT",
  headers: { cookie, "content-type": "application/json" },
  body,
});

describe("GET /api/desktop/tray", () => {
  it("serves null before the shell's first push, then the stored state", async () => {
    const t = await createDesktopApp();
    try {
      const cookie = await desktopLoginCookie(t.app);
      const before = await t.app.request("/api/desktop/tray", { headers: { cookie } });
      expect(before.status).toBe(200);
      expect((await before.json()) as DesktopTrayStatusResponse).toEqual({ status: null });

      t.deps.desktop!.setTrayStatus({ showTrayIcon: false, locale: "en" });
      const after = await t.app.request("/api/desktop/tray", { headers: { cookie } });
      expect((await after.json()) as DesktopTrayStatusResponse).toEqual({
        status: { showTrayIcon: false, locale: "en" },
      });
    } finally {
      await t.cleanup();
    }
  });

  it("answers 403 desktop_shell_only to a password-established session", async () => {
    const t = await createDesktopApp();
    try {
      const admin = await loginAdmin(t.app);
      const res = await t.app.request("/api/desktop/tray", { headers: { cookie: admin.cookie } });
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
      const res = await t.app.request("/api/desktop/tray", { headers: { cookie: admin.cookie } });
      expect(res.status).toBe(404);
    } finally {
      await t.cleanup();
    }
  });
});

describe("PUT /api/desktop/tray", () => {
  it("forwards the switch to the registered shell sender and answers 202", async () => {
    const t = await createDesktopApp();
    try {
      const cookie = await desktopLoginCookie(t.app);
      const sent: DesktopTrayPatch[] = [];
      t.deps.desktop!.onTrayCommand((patch) => sent.push(patch));

      const off = await t.app.request("/api/desktop/tray", put(cookie, '{"showTrayIcon":false}'));
      expect(off.status).toBe(202);
      const on = await t.app.request("/api/desktop/tray", put(cookie, '{"showTrayIcon":true}'));
      expect(on.status).toBe(202);
      expect(sent).toEqual([{ showTrayIcon: false }, { showTrayIcon: true }]);
    } finally {
      await t.cleanup();
    }
  });

  it("refuses a field it cannot read, and a request that asks for nothing", async () => {
    const t = await createDesktopApp();
    try {
      const cookie = await desktopLoginCookie(t.app);
      const sent: DesktopTrayPatch[] = [];
      t.deps.desktop!.onTrayCommand((patch) => sent.push(patch));
      const cases: Array<[string, string]> = [
        ['{"showTrayIcon":"off"}', "invalid_show_tray_icon"],
        ['{"showTrayIcon":0}', "invalid_show_tray_icon"],
        ['{"locale":"fr"}', "invalid_locale"],
        ['{"locale":true}', "invalid_locale"],
        // Nothing to do is a caller bug, not a no-op worth waking the shell for. An
        // unparseable body lands here too: it asks for nothing this route understands.
        ["{}", "empty_tray_patch"],
        ["not json", "empty_tray_patch"],
      ];
      for (const [body, code] of cases) {
        const res = await t.app.request("/api/desktop/tray", put(cookie, body));
        expect(res.status, body).toBe(400);
        expect(((await res.json()) as ErrorBody).error.code, body).toBe(code);
      }
      expect(sent).toEqual([]);
    } finally {
      await t.cleanup();
    }
  });

  it("refuses a password session, and answers 503 while no port is wired", async () => {
    const t = await createDesktopApp();
    try {
      const admin = await loginAdmin(t.app);
      const forbidden = await t.app.request(
        "/api/desktop/tray",
        put(admin.cookie, '{"showTrayIcon":false}'),
      );
      expect(forbidden.status).toBe(403);

      const cookie = await desktopLoginCookie(t.app);
      const unreachable = await t.app.request(
        "/api/desktop/tray",
        put(cookie, '{"showTrayIcon":false}'),
      );
      expect(unreachable.status).toBe(503);
      expect(((await unreachable.json()) as ErrorBody).error.code).toBe("shell_unreachable");
    } finally {
      await t.cleanup();
    }
  });
});

describe("the tray half of the shell port", () => {
  it("parses only well-formed tray status frames", () => {
    expect(
      parseTrayStatusMessage({
        type: "desktop-tray-status",
        status: { showTrayIcon: true, locale: "zh" },
      }),
    ).toEqual({ showTrayIcon: true, locale: "zh" });
    // A shell older than this server pushes no language. Reading it as English keeps the
    // icon switch working across that pairing rather than dropping the whole push.
    expect(
      parseTrayStatusMessage({ type: "desktop-tray-status", status: { showTrayIcon: true } }),
    ).toEqual({ showTrayIcon: true, locale: "en" });
    expect(
      parseTrayStatusMessage({
        type: "desktop-tray-status",
        status: { showTrayIcon: true, locale: "fr" },
      }),
    ).toEqual({ showTrayIcon: true, locale: "en" });
    for (const data of [
      null,
      "status",
      {},
      { type: "desktop-tray-status" },
      { type: "desktop-tray-status", status: null },
      { type: "desktop-tray-status", status: {} },
      { type: "desktop-tray-status", status: { showTrayIcon: "yes" } },
      // The updater's frames ride the same port and must not be read as tray ones.
      { type: "desktop-updater-status", status: { appVersion: "1", state: "idle" } },
    ]) {
      expect(parseTrayStatusMessage(data)).toBeNull();
    }
  });

  it("stores tray pushes and posts tray commands beside the updater's, on one port", () => {
    const desktop = new DesktopService("t");
    const port = new FakePort();
    wireShellUpdatePort(desktop, port);

    port.emit({ type: "desktop-tray-status", status: { showTrayIcon: false, locale: "zh" } });
    expect(desktop.getTrayStatus()).toEqual({ showTrayIcon: false, locale: "zh" });
    // An updater frame on the same port leaves the tray state alone, and vice versa.
    port.emit({ type: "desktop-updater-status", status: { appVersion: "1", state: "idle" } });
    expect(desktop.getTrayStatus()).toEqual({ showTrayIcon: false, locale: "zh" });
    expect(desktop.getUpdateStatus()).toEqual({ appVersion: "1", state: "idle" });

    expect(desktop.requestTrayCommand({ showTrayIcon: true })).toBe(true);
    expect(port.sent).toEqual([{ type: "desktop-tray-command", showTrayIcon: true }]);
  });
});
