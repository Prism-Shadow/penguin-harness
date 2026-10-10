/**
 * The Workspace picker's macOS folder access, server side. POST /api/projects/:p/dirs/access
 * relays a refused folder to the desktop shell, whose main process reads it in the app's own
 * name, and answers what that read came to. POST /api/desktop/privacy-settings has the shell
 * open a Privacy & Security pane, under the same gate as the other page-facing desktop routes.
 *
 * - The shell reads the folder and the route answers what the read came to (granted or not,
 *   packaged or not), each request carrying its own id; the errno stays in the shell's log.
 * - A path that is not absolute is refused before the shell is asked.
 * - Anything but the desktop app's own window is refused: a plain server's session, and a
 *   password session on the desktop app's own server.
 * - With no shell to ask the route answers 503; with a shell that does not answer in time, 504.
 * - The Project stays the authorization anchor: a Project the caller cannot reach is a 404.
 * - The privacy pane is relayed to the shell and answered 202; an unknown pane is refused;
 *   only the shell's own window may ask; with no shell wired it is 503, and a plain server has
 *   no such route.
 * - The port pairs each reply with the request it answers, reads only well-formed replies, and
 *   drops a reply that arrives after its request gave up.
 *
 * The route cases drive the real port glue against a fake shell on the far side of the port,
 * so the frames themselves are exercised, not just the service's seam.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
import { FakePort } from "./builtin-browser/fake-shell.js";
import {
  apiClient,
  createDesktopApp,
  createTestApp,
  desktopLoginCookie,
  loginAdmin,
} from "./helpers.js";
import type { TestApp } from "./helpers.js";

const DOWNLOADS = "/Users/me/Downloads";
const ACCESS = "/api/projects/default_project/dirs/access";
const SETTINGS = "/api/desktop/privacy-settings";

/**
 * A shell on the far side of the port: every folder-access request is answered, a tick later,
 * the way `answer` says; every frame the server posts is kept in `port.sent`.
 */
function fakeShell(answer: (path: string) => DesktopFolderAccessResult): FakePort {
  const port = new FakePort();
  port.onPost = (message) => {
    const frame = message as Record<string, unknown>;
    if (frame.type !== "desktop-folder-access") return;
    setTimeout(() =>
      port.emit({
        type: "desktop-folder-access-result",
        id: frame.id,
        ...answer(String(frame.path)),
      }),
    );
  };
  return port;
}

const errorCode = async (res: Response): Promise<string> =>
  ((await res.json()) as ErrorBody).error.code;

/** A desktop-mode app with the shell window's own session, shared by a describe. */
function desktopApp() {
  const state = {} as { t: TestApp; api: ReturnType<typeof apiClient>; cookie: string };
  beforeAll(async () => {
    state.t = await createDesktopApp();
    state.cookie = await desktopLoginCookie(state.t.app);
    state.api = apiClient(state.t.app, state.cookie);
  });
  afterAll(async () => {
    await state.t.cleanup();
  });
  return state;
}

/** A fresh desktop app with no shell wired, for the cases about its absence. */
async function withUnwiredDesktop(run: (api: ReturnType<typeof apiClient>) => Promise<void>) {
  const t = await createDesktopApp();
  try {
    await run(apiClient(t.app, await desktopLoginCookie(t.app)));
  } finally {
    await t.cleanup();
  }
}

/** A plain (non-desktop) server's admin session. */
async function withPlainServer(run: (api: ReturnType<typeof apiClient>) => Promise<void>) {
  const plain = await createTestApp();
  try {
    await run(apiClient(plain.app, (await loginAdmin(plain.app)).cookie));
  } finally {
    await plain.cleanup();
  }
}

describe("POST /api/projects/:projectId/dirs/access", () => {
  const app = desktopApp();

  it("has the shell read the folder and answers what the read came to", async () => {
    let granted = false;
    const shell = fakeShell(() => ({
      granted,
      ...(granted ? {} : { code: "EPERM" }),
      packaged: true,
    }));
    wireShellUpdatePort(app.t.deps.desktop!, shell);

    const refused = await app.api.post(ACCESS, { path: DOWNLOADS });
    expect(refused.status).toBe(200);
    // The errno stays in the shell's log: the page acts on the two booleans alone.
    expect((await refused.json()) as DirAccessResponse).toEqual({ granted: false, packaged: true });
    expect(shell.sent).toEqual([
      { type: "desktop-folder-access", id: expect.any(String), path: DOWNLOADS },
    ]);

    granted = true;
    const allowed = await app.api.post(ACCESS, { path: DOWNLOADS });
    expect((await allowed.json()) as DirAccessResponse).toEqual({ granted: true, packaged: true });
    // Every request carries its own id, so a reply can only settle the one it answers.
    const ids = (shell.sent as Array<{ id: string }>).map((frame) => frame.id);
    expect(ids[1]).not.toBe(ids[0]);
  });

  it("reports an unpackaged app, whose reads macOS charges to the terminal", async () => {
    wireShellUpdatePort(
      app.t.deps.desktop!,
      fakeShell(() => ({ granted: false, code: "EPERM", packaged: false })),
    );
    const res = await app.api.post(ACCESS, { path: DOWNLOADS });
    expect((await res.json()) as DirAccessResponse).toEqual({ granted: false, packaged: false });
  });

  it("refuses a path that is not absolute before asking the shell", async () => {
    const asked: string[] = [];
    app.t.deps.desktop!.onFolderAccessRequest(async (path) => {
      asked.push(path);
      return { granted: true, packaged: true };
    });
    for (const body of ['{"path":"Downloads"}', '{"path":""}', '{"path":7}', "{}", "not json"]) {
      const res = await app.t.app.request(ACCESS, {
        method: "POST",
        headers: { cookie: app.cookie, "content-type": "application/json" },
        body,
      });
      expect(res.status, body).toBe(400);
      expect(await errorCode(res), body).toBe("dir_not_absolute");
    }
    expect(asked).toEqual([]);
  });

  it("is refused to anything but the desktop app's own window", async () => {
    // A plain server's password session: no window of the shell's at all.
    await withPlainServer(async (api) => {
      const res = await api.post(ACCESS, { path: DOWNLOADS });
      expect(res.status).toBe(403);
      expect(await errorCode(res)).toBe("desktop_shell_only");
    });
    // A browser tab signed in with the password on the desktop app's own server.
    let asked = 0;
    app.t.deps.desktop!.onFolderAccessRequest(async () => {
      asked += 1;
      return { granted: true, packaged: true };
    });
    const admin = apiClient(app.t.app, (await loginAdmin(app.t.app)).cookie);
    const res = await admin.post(ACCESS, { path: DOWNLOADS });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("desktop_shell_only");
    expect(asked).toBe(0);
  });

  it("answers 503 shell_unreachable with no shell to ask", async () => {
    await withUnwiredDesktop(async (api) => {
      const res = await api.post(ACCESS, { path: DOWNLOADS });
      expect(res.status).toBe(503);
      expect(await errorCode(res)).toBe("shell_unreachable");
    });
  });

  it("answers 504 timeout when the shell does not answer in time", async () => {
    app.t.deps.desktop!.onFolderAccessRequest(async () => null);
    const res = await app.api.post(ACCESS, { path: DOWNLOADS });
    expect(res.status).toBe(504);
    expect(await errorCode(res)).toBe("timeout");
  });

  it("keeps the Project as the authorization anchor", async () => {
    const asked: string[] = [];
    app.t.deps.desktop!.onFolderAccessRequest(async (path) => {
      asked.push(path);
      return { granted: true, packaged: true };
    });
    const res = await app.api.post("/api/projects/nobody_s_project/dirs/access", {
      path: DOWNLOADS,
    });
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("project_not_found");
    expect(asked).toEqual([]);
  });
});

describe("POST /api/desktop/privacy-settings", () => {
  const app = desktopApp();

  it("relays the pane to the shell and answers 202", async () => {
    const shell = fakeShell(() => ({ granted: true, packaged: true }));
    wireShellUpdatePort(app.t.deps.desktop!, shell);
    for (const pane of ["files", "fullDisk"] satisfies DesktopPrivacyPane[]) {
      const res = await app.api.post(SETTINGS, { pane });
      expect(res.status, pane).toBe(202);
    }
    expect(shell.sent).toEqual([
      { type: "desktop-open-privacy-settings", pane: "files" },
      { type: "desktop-open-privacy-settings", pane: "fullDisk" },
    ]);
  });

  it("refuses a pane it does not know", async () => {
    const sent: DesktopPrivacyPane[] = [];
    app.t.deps.desktop!.onPrivacySettingsCommand((pane) => sent.push(pane));
    for (const body of ['{"pane":"camera"}', '{"pane":true}', "{}", "not json"]) {
      const res = await app.t.app.request(SETTINGS, {
        method: "POST",
        headers: { cookie: app.cookie, "content-type": "application/json" },
        body,
      });
      expect(res.status, body).toBe(400);
      expect(await errorCode(res), body).toBe("invalid_privacy_pane");
    }
    expect(sent).toEqual([]);
  });

  it("answers only the shell's own window, like the other desktop routes", async () => {
    const sent: DesktopPrivacyPane[] = [];
    app.t.deps.desktop!.onPrivacySettingsCommand((pane) => sent.push(pane));
    // A password session against the same server may be on another machine: System Settings
    // springing open on this one means nothing there.
    const admin = apiClient(app.t.app, (await loginAdmin(app.t.app)).cookie);
    const forbidden = await admin.post(SETTINGS, { pane: "files" });
    expect(forbidden.status).toBe(403);
    expect(await errorCode(forbidden)).toBe("desktop_shell_only");
    const anonymous = await app.t.app.request(SETTINGS, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"pane":"files"}',
    });
    expect(anonymous.status).toBe(401);
    expect(sent).toEqual([]);
  });

  it("answers 503 while no port is wired, and does not exist outside desktop mode", async () => {
    await withUnwiredDesktop(async (api) => {
      const res = await api.post(SETTINGS, { pane: "files" });
      expect(res.status).toBe(503);
      expect(await errorCode(res)).toBe("shell_unreachable");
    });
    await withPlainServer(async (api) => {
      expect((await api.post(SETTINGS, { pane: "files" })).status).toBe(404);
    });
  });
});

describe("the folder-access half of the shell port", () => {
  const reply = (fields: Record<string, unknown>) => ({
    type: "desktop-folder-access-result",
    ...fields,
  });

  it("parses only well-formed replies", () => {
    expect(
      parseFolderAccessResultMessage(
        reply({ id: "a", granted: false, code: "EPERM", packaged: true }),
      ),
    ).toEqual(reply({ id: "a", granted: false, code: "EPERM", packaged: true }));
    // A code that is not a string is left out rather than failing the whole reply.
    expect(
      parseFolderAccessResultMessage(reply({ id: "a", granted: true, code: 1, packaged: false })),
    ).toEqual(reply({ id: "a", granted: true, packaged: false }));
    for (const data of [
      null,
      {},
      reply({ granted: true, packaged: true }),
      reply({ id: "a", packaged: true }),
      reply({ id: "a", granted: "yes", packaged: true }),
      reply({ id: "a", granted: true }),
      // The request's own shape, and the other frames on the same port, are not replies.
      { type: "desktop-folder-access", id: "a", path: DOWNLOADS },
      { type: "desktop-tray-status", status: { showTrayIcon: true, locale: "en" } },
    ]) {
      expect(parseFolderAccessResultMessage(data)).toBeNull();
    }
  });

  it("settles a request only with the reply carrying its id", async () => {
    const desktop = new DesktopService("t");
    const port = new FakePort();
    wireShellUpdatePort(desktop, port);
    const pending = desktop.requestFolderAccess(DOWNLOADS);
    expect(pending).not.toBeNull();
    const id = (port.sent[0] as { id: string }).id;
    let settled = false;
    void pending!.then(() => {
      settled = true;
    });
    port.emit(reply({ id: `${id}-other`, granted: true, packaged: true }));
    await Promise.resolve();
    expect(settled).toBe(false);
    port.emit(reply({ id, granted: false, code: "EPERM", packaged: true }));
    await expect(pending).resolves.toEqual({ granted: false, code: "EPERM", packaged: true });
  });

  it("gives up after the timeout, and drops the reply that comes later", async () => {
    vi.useFakeTimers();
    try {
      const desktop = new DesktopService("t");
      const port = new FakePort();
      wireShellUpdatePort(desktop, port);
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
      const { id } = port.sent[0] as { id: string };
      expect(() => port.emit(reply({ id, granted: true, packaged: true }))).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});
