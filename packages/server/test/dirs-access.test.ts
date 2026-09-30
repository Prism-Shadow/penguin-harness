/**
 * The Workspace picker's macOS folder access, server side. POST /api/projects/:p/dirs/access
 * relays a refused folder to the desktop shell, whose main process reads it in the app's own
 * name, and answers what that read came to — 503 `shell_unreachable` when this server has no
 * shell to ask. POST /api/desktop/privacy-settings has the shell open a Privacy & Security
 * pane, under the same gate as the other page-facing desktop routes. The port glue pairs each
 * shell reply with the request it answers, and a reply that comes after its request gave up
 * is dropped.
 *
 * The route tests drive the real port glue against a fake shell on the far side of the port,
 * so the frames themselves are exercised, not just the service's seam.
 */
import { describe, expect, it, vi } from "vitest";
import type {
  DesktopFolderAccessResult,
  DesktopPrivacyPane,
  DirAccessResponse,
  ErrorBody,
} from "../src/api/types.js";
import { DesktopService } from "../src/services/desktop-service.js";
import {
  FOLDER_ACCESS_TIMEOUT_MS,
  parseFolderAccessResultMessage,
  wireShellUpdatePort,
} from "../src/services/desktop-update-port.js";
import type { ShellPort } from "../src/services/desktop-update-port.js";
import {
  apiClient,
  createDesktopApp,
  createTestApp,
  desktopLoginCookie,
  loginAdmin,
} from "./helpers.js";

const DOWNLOADS = "/Users/me/Downloads";
const ACCESS = "/api/projects/default_project/dirs/access";
const SETTINGS = "/api/desktop/privacy-settings";

/**
 * A shell on the far side of the port: every folder-access request is answered, a tick later,
 * the way `answer` says; every frame the server posts is kept.
 */
function fakeShell(answer: (path: string) => DesktopFolderAccessResult) {
  const posted: Record<string, unknown>[] = [];
  let listener: ((e: { data: unknown }) => void) | undefined;
  const port: ShellPort = {
    on: (_event, l) => {
      listener = l;
    },
    postMessage: (message) => {
      const frame = message as Record<string, unknown>;
      posted.push(frame);
      if (frame.type !== "desktop-folder-access") return;
      setTimeout(() =>
        listener?.({
          data: {
            type: "desktop-folder-access-result",
            id: frame.id,
            ...answer(frame.path as string),
          },
        }),
      );
    },
  };
  return { port, posted };
}

const errorCode = async (res: Response): Promise<string> =>
  ((await res.json()) as ErrorBody).error.code;

describe("POST /api/projects/:projectId/dirs/access", () => {
  it("has the shell read the folder and answers what the read came to", async () => {
    const t = await createDesktopApp();
    try {
      const api = apiClient(t.app, await desktopLoginCookie(t.app));
      let granted = false;
      const shell = fakeShell(() => ({
        granted,
        ...(granted ? {} : { code: "EPERM" }),
        packaged: true,
      }));
      wireShellUpdatePort(t.deps.desktop!, shell.port);

      const refused = await api.post(ACCESS, { path: DOWNLOADS });
      expect(refused.status).toBe(200);
      // The errno stays in the shell's log: the page acts on the two booleans alone.
      expect((await refused.json()) as DirAccessResponse).toEqual({
        granted: false,
        packaged: true,
      });
      expect(shell.posted).toEqual([
        { type: "desktop-folder-access", id: expect.any(String), path: DOWNLOADS },
      ]);

      granted = true;
      const allowed = await api.post(ACCESS, { path: DOWNLOADS });
      expect((await allowed.json()) as DirAccessResponse).toEqual({
        granted: true,
        packaged: true,
      });
      // Every request carries its own id, so a reply can only settle the one it answers.
      expect(shell.posted[1]!.id).not.toBe(shell.posted[0]!.id);
    } finally {
      await t.cleanup();
    }
  });

  it("reports an unpackaged app, whose reads macOS charges to the terminal", async () => {
    const t = await createDesktopApp();
    try {
      const api = apiClient(t.app, await desktopLoginCookie(t.app));
      wireShellUpdatePort(
        t.deps.desktop!,
        fakeShell(() => ({ granted: false, code: "EPERM", packaged: false })).port,
      );
      const res = await api.post(ACCESS, { path: DOWNLOADS });
      expect((await res.json()) as DirAccessResponse).toEqual({ granted: false, packaged: false });
    } finally {
      await t.cleanup();
    }
  });

  it("refuses a path that is not absolute before asking the shell", async () => {
    const t = await createDesktopApp();
    try {
      const cookie = await desktopLoginCookie(t.app);
      const asked: string[] = [];
      t.deps.desktop!.onFolderAccessRequest(async (path) => {
        asked.push(path);
        return { granted: true, packaged: true };
      });
      for (const body of ['{"path":"Downloads"}', '{"path":""}', '{"path":7}', "{}", "not json"]) {
        const res = await t.app.request(ACCESS, {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body,
        });
        expect(res.status, body).toBe(400);
        expect(await errorCode(res), body).toBe("dir_not_absolute");
      }
      expect(asked).toEqual([]);
    } finally {
      await t.cleanup();
    }
  });

  it("is refused to anything but the desktop app's own window", async () => {
    // A plain server's password session: no window of the shell's at all.
    const plain = await createTestApp();
    try {
      const admin = await loginAdmin(plain.app);
      const res = await apiClient(plain.app, admin.cookie).post(ACCESS, { path: DOWNLOADS });
      expect(res.status).toBe(403);
      expect(await errorCode(res)).toBe("desktop_shell_only");
    } finally {
      await plain.cleanup();
    }
    // A browser tab signed in with the password on the desktop app's own server.
    const t = await createDesktopApp();
    try {
      let asked = 0;
      t.deps.desktop!.onFolderAccessRequest(async () => {
        asked += 1;
        return { granted: true, packaged: true };
      });
      const admin = await loginAdmin(t.app);
      const res = await apiClient(t.app, admin.cookie).post(ACCESS, { path: DOWNLOADS });
      expect(res.status).toBe(403);
      expect(await errorCode(res)).toBe("desktop_shell_only");
      expect(asked).toBe(0);
    } finally {
      await t.cleanup();
    }
  });

  it("answers 503 shell_unreachable with no shell to ask", async () => {
    // Desktop mode, but no port wired.
    const t = await createDesktopApp();
    try {
      const api = apiClient(t.app, await desktopLoginCookie(t.app));
      const res = await api.post(ACCESS, { path: DOWNLOADS });
      expect(res.status).toBe(503);
      expect(await errorCode(res)).toBe("shell_unreachable");
    } finally {
      await t.cleanup();
    }
  });

  it("answers 504 timeout when the shell does not answer in time", async () => {
    const t = await createDesktopApp();
    try {
      const api = apiClient(t.app, await desktopLoginCookie(t.app));
      t.deps.desktop!.onFolderAccessRequest(async () => null);
      const res = await api.post(ACCESS, { path: DOWNLOADS });
      expect(res.status).toBe(504);
      expect(await errorCode(res)).toBe("timeout");
    } finally {
      await t.cleanup();
    }
  });

  it("keeps the Project as the authorization anchor", async () => {
    const t = await createDesktopApp();
    try {
      const api = apiClient(t.app, await desktopLoginCookie(t.app));
      const asked: string[] = [];
      t.deps.desktop!.onFolderAccessRequest(async (path) => {
        asked.push(path);
        return { granted: true, packaged: true };
      });
      const res = await api.post("/api/projects/nobody_s_project/dirs/access", {
        path: DOWNLOADS,
      });
      expect(res.status).toBe(404);
      expect(await errorCode(res)).toBe("project_not_found");
      expect(asked).toEqual([]);
    } finally {
      await t.cleanup();
    }
  });
});

describe("POST /api/desktop/privacy-settings", () => {
  it("relays the pane to the shell and answers 202", async () => {
    const t = await createDesktopApp();
    try {
      const api = apiClient(t.app, await desktopLoginCookie(t.app));
      const shell = fakeShell(() => ({ granted: true, packaged: true }));
      wireShellUpdatePort(t.deps.desktop!, shell.port);
      for (const pane of ["files", "fullDisk"] satisfies DesktopPrivacyPane[]) {
        const res = await api.post(SETTINGS, { pane });
        expect(res.status, pane).toBe(202);
      }
      expect(shell.posted).toEqual([
        { type: "desktop-open-privacy-settings", pane: "files" },
        { type: "desktop-open-privacy-settings", pane: "fullDisk" },
      ]);
    } finally {
      await t.cleanup();
    }
  });

  it("refuses a pane it does not know", async () => {
    const t = await createDesktopApp();
    try {
      const cookie = await desktopLoginCookie(t.app);
      const sent: DesktopPrivacyPane[] = [];
      t.deps.desktop!.onPrivacySettingsCommand((pane) => sent.push(pane));
      for (const body of ['{"pane":"camera"}', '{"pane":true}', "{}", "not json"]) {
        const res = await t.app.request(SETTINGS, {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body,
        });
        expect(res.status, body).toBe(400);
        expect(await errorCode(res), body).toBe("invalid_privacy_pane");
      }
      expect(sent).toEqual([]);
    } finally {
      await t.cleanup();
    }
  });

  it("answers only the shell's own window, like the other desktop routes", async () => {
    const t = await createDesktopApp();
    try {
      const sent: DesktopPrivacyPane[] = [];
      t.deps.desktop!.onPrivacySettingsCommand((pane) => sent.push(pane));
      // A password session against the same server may be on another machine: System
      // Settings springing open on this one means nothing there.
      const admin = await loginAdmin(t.app);
      const forbidden = await apiClient(t.app, admin.cookie).post(SETTINGS, { pane: "files" });
      expect(forbidden.status).toBe(403);
      expect(await errorCode(forbidden)).toBe("desktop_shell_only");
      const anonymous = await t.app.request(SETTINGS, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"pane":"files"}',
      });
      expect(anonymous.status).toBe(401);
      expect(sent).toEqual([]);
    } finally {
      await t.cleanup();
    }
  });

  it("answers 503 shell_unreachable while no port is wired, and does not exist outside desktop mode", async () => {
    const t = await createDesktopApp();
    try {
      const api = apiClient(t.app, await desktopLoginCookie(t.app));
      const res = await api.post(SETTINGS, { pane: "files" });
      expect(res.status).toBe(503);
      expect(await errorCode(res)).toBe("shell_unreachable");
    } finally {
      await t.cleanup();
    }
    const plain = await createTestApp();
    try {
      const admin = await loginAdmin(plain.app);
      const res = await apiClient(plain.app, admin.cookie).post(SETTINGS, { pane: "files" });
      expect(res.status).toBe(404);
    } finally {
      await plain.cleanup();
    }
  });
});

describe("the folder-access half of the shell port", () => {
  it("parses only well-formed replies", () => {
    expect(
      parseFolderAccessResultMessage({
        type: "desktop-folder-access-result",
        id: "a",
        granted: false,
        code: "EPERM",
        packaged: true,
      }),
    ).toEqual({
      type: "desktop-folder-access-result",
      id: "a",
      granted: false,
      code: "EPERM",
      packaged: true,
    });
    // A code that is not a string is left out rather than failing the whole reply.
    expect(
      parseFolderAccessResultMessage({
        type: "desktop-folder-access-result",
        id: "a",
        granted: true,
        code: 1,
        packaged: false,
      }),
    ).toEqual({ type: "desktop-folder-access-result", id: "a", granted: true, packaged: false });
    for (const data of [
      null,
      {},
      { type: "desktop-folder-access-result", granted: true, packaged: true },
      { type: "desktop-folder-access-result", id: "a", packaged: true },
      { type: "desktop-folder-access-result", id: "a", granted: "yes", packaged: true },
      { type: "desktop-folder-access-result", id: "a", granted: true },
      // The request's own shape, and the other frames on the same port, are not replies.
      { type: "desktop-folder-access", id: "a", path: DOWNLOADS },
      { type: "desktop-tray-status", status: { showTrayIcon: true, locale: "en" } },
    ]) {
      expect(parseFolderAccessResultMessage(data)).toBeNull();
    }
  });

  it("settles a request only with the reply carrying its id", async () => {
    const desktop = new DesktopService("t");
    const posted: Record<string, unknown>[] = [];
    let onMessage: ((e: { data: unknown }) => void) | undefined;
    wireShellUpdatePort(desktop, {
      on: (_event, listener) => {
        onMessage = listener;
      },
      postMessage: (message) => posted.push(message as Record<string, unknown>),
    });
    const pending = desktop.requestFolderAccess(DOWNLOADS);
    expect(pending).not.toBeNull();
    const id = posted[0]!.id as string;
    let settled = false;
    void pending!.then(() => {
      settled = true;
    });
    onMessage!({
      data: {
        type: "desktop-folder-access-result",
        id: `${id}-other`,
        granted: true,
        packaged: true,
      },
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    onMessage!({
      data: {
        type: "desktop-folder-access-result",
        id,
        granted: false,
        code: "EPERM",
        packaged: true,
      },
    });
    await expect(pending).resolves.toEqual({ granted: false, code: "EPERM", packaged: true });
  });

  it("gives up after the timeout, and drops the reply that comes later", async () => {
    vi.useFakeTimers();
    try {
      const desktop = new DesktopService("t");
      const posted: Record<string, unknown>[] = [];
      let onMessage: ((e: { data: unknown }) => void) | undefined;
      wireShellUpdatePort(desktop, {
        on: (_event, listener) => {
          onMessage = listener;
        },
        postMessage: (message) => posted.push(message as Record<string, unknown>),
      });
      const pending = desktop.requestFolderAccess(DOWNLOADS)!;
      vi.advanceTimersByTime(FOLDER_ACCESS_TIMEOUT_MS - 1);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      vi.advanceTimersByTime(1);
      await expect(pending).resolves.toBeNull();
      // Nobody waits for it any more: the late reply is dropped without a trace.
      expect(() =>
        onMessage!({
          data: {
            type: "desktop-folder-access-result",
            id: posted[0]!.id,
            granted: true,
            packaged: true,
          },
        }),
      ).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports no shell before a port is wired", () => {
    const desktop = new DesktopService("t");
    expect(desktop.requestFolderAccess(DOWNLOADS)).toBeNull();
    expect(desktop.requestPrivacySettings("files")).toBe(false);
  });
});
