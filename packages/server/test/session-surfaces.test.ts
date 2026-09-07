/**
 * Session surfaces: a plugin contributes one through `SessionSurfacesModule.surfaces`, the
 * App lists it, a Session can be created OF that kind, and its surface is opened, asked
 * about and closed through /api/sessions/:id/surface — with its state coming from the
 * surface, not the SessionManager, and its flips stamping the row the way a run's do.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import type { ModuleDef } from "@prismshadow/penguin-core/kernel";
import type {
  SessionSurface,
  SurfaceSessionRef,
  SurfaceState,
} from "@prismshadow/penguin-core/plugin";
import type {
  ContributionsResponse,
  SessionCreateResponse,
  SessionResponse,
  SessionSurfaceResponse,
} from "../src/api/types.js";
import { PluginHost } from "../src/plugin/host.js";
import { TerminalManager, spawnFailureMessage } from "../src/terminal/manager.js";
import { apiClient, createTestApp, loginAdmin, type TestApp } from "./helpers.js";

/** A surface whose state the test flips by hand; records what it was asked to open. */
function fakeSurface() {
  const opened = new Map<string, { ref: SurfaceSessionRef; prompt?: string; alive: boolean }>();
  const reporters = new Map<string, (state: SurfaceState) => void>();
  const states = new Map<string, SurfaceState>();
  const surface: SessionSurface = {
    async open(ref, options, report) {
      const existing = opened.get(ref.sessionId);
      if (existing?.alive) return { alive: true, view: { handle: `h:${ref.sessionId}` } };
      opened.set(ref.sessionId, {
        ref,
        ...(options.prompt !== undefined ? { prompt: options.prompt } : {}),
        alive: true,
      });
      reporters.set(ref.sessionId, report);
      states.set(ref.sessionId, "idle");
      return { alive: true, view: { handle: `h:${ref.sessionId}` } };
    },
    view(sessionId) {
      const entry = opened.get(sessionId);
      return entry === undefined
        ? null
        : { alive: entry.alive, view: { handle: `h:${sessionId}` } };
    },
    status: (sessionId) => states.get(sessionId) ?? "idle",
    close(sessionId) {
      const entry = opened.get(sessionId);
      if (entry) entry.alive = false;
      states.set(sessionId, "idle");
    },
  };
  const flip = (sessionId: string, state: SurfaceState) => {
    states.set(sessionId, state);
    reporters.get(sessionId)?.(state);
  };
  return { surface, opened, flip };
}

function surfacePlugin(kind: string, surface: SessionSurface, label = "Fake"): ModuleDef {
  return {
    manifest: parseManifest({
      name: `ext-${kind}`,
      requires: {},
      provides: {},
      contributes: {
        "SessionSurfacesModule.surfaces": [
          { id: `ext-${kind}.surface`, kind, label, renderer: { builtin: "TerminalSurface" } },
        ],
      },
      children: [],
    }),
    create: () => ({ api: {}, bind: { [`ext-${kind}.surface`]: surface } }),
  };
}

const SESSIONS = "/api/projects/default_project/agents/default_agent/sessions";

describe("session surfaces", () => {
  let t: TestApp;
  let fake: ReturnType<typeof fakeSurface>;
  let api: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    fake = fakeSurface();
    const plugins = new PluginHost();
    plugins.use({
      specifier: "fake",
      modules: [surfacePlugin("fake", fake.surface)],
      replaces: [],
    });
    t = await createTestApp({ plugins });
    api = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  });
  afterEach(() => t.cleanup());

  it("lists the contributed surface with the App's contributions", async () => {
    const res = await api.get("/api/contributions");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ContributionsResponse;
    expect(body.sessionSurfaces).toEqual([
      {
        id: "ext-fake.surface",
        from: "ext-fake",
        kind: "fake",
        label: "Fake",
        renderer: { builtin: "TerminalSurface" },
      },
    ]);
  });

  it("refuses a Session of a kind nobody contributes", async () => {
    const res = await api.post(SESSIONS, { surface: "nobody" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("unknown_surface");
  });

  it("creates a surface Session with no model, and opens, reports and closes its surface", async () => {
    const created = await api.post(SESSIONS, { surface: "fake" });
    expect(created.status).toBe(201);
    const { session } = (await created.json()) as SessionCreateResponse;
    expect(session.surface).toBe("fake");
    expect(session.provider).toBe("");
    expect(session.modelId).toBe("");
    expect(session.status).toBe("idle");
    expect(session.hasTrace).toBe(false);

    // Never opened: nothing to attach to yet.
    const before = (await (
      await api.get(`/api/sessions/${session.sessionId}/surface`)
    ).json()) as SessionSurfaceResponse;
    expect(before).toEqual({ kind: "fake", status: "idle", opened: false, alive: false });

    const opened = await api.post(`/api/sessions/${session.sessionId}/surface`, { prompt: "hi" });
    expect(opened.status).toBe(200);
    expect((await opened.json()) as SessionSurfaceResponse).toEqual({
      kind: "fake",
      status: "idle",
      opened: true,
      alive: true,
      view: { handle: `h:${session.sessionId}` },
    });
    const ask = fake.opened.get(session.sessionId)!;
    expect(ask.prompt).toBe("hi");
    expect(ask.ref.workspace).toBe(session.workspace);
    expect(ask.ref.ownerUserId).toBe("admin");

    // Opening again is the same surface, not a second one.
    await api.post(`/api/sessions/${session.sessionId}/surface`, {});
    expect(fake.opened.size).toBe(1);

    // The surface's state is the Session's state, and a flip stamps the row like a run does.
    fake.flip(session.sessionId, "running");
    let info = (
      (await (await api.get(`/api/sessions/${session.sessionId}`)).json()) as SessionResponse
    ).session;
    expect(info.status).toBe("running");
    expect(info.hasTrace).toBe(true);
    fake.flip(session.sessionId, "idle");
    info = ((await (await api.get(`/api/sessions/${session.sessionId}`)).json()) as SessionResponse)
      .session;
    expect(info.status).toBe("idle");
    expect(info.lastActiveAt >= session.lastActiveAt).toBe(true);

    // A surface Session takes no Tasks: there is no runtime entry to drive.
    const task = await api.post(`/api/sessions/${session.sessionId}/tasks`, {
      input: [{ type: "text", text: "x" }],
    });
    expect(task.status).toBe(409);
    expect(((await task.json()) as { error: { code: string } }).error.code).toBe("surface_session");

    const closed = await api.delete(`/api/sessions/${session.sessionId}/surface`);
    expect(closed.status).toBe(204);
    expect(fake.opened.get(session.sessionId)!.alive).toBe(false);
  });

  it("deleting a surface Session closes its surface", async () => {
    const { session } = (await (
      await api.post(SESSIONS, { surface: "fake" })
    ).json()) as SessionCreateResponse;
    await api.post(`/api/sessions/${session.sessionId}/surface`, {});
    expect((await api.delete(`/api/sessions/${session.sessionId}`)).status).toBe(204);
    expect(fake.opened.get(session.sessionId)!.alive).toBe(false);
    expect((await api.get(`/api/sessions/${session.sessionId}/surface`)).status).toBe(404);
  });

  it("a conversation has no surface to open", async () => {
    // A plain Session needs a model; the surface routes answer before that matters.
    const res = await api.get("/api/sessions/session-does-not-exist/surface");
    expect(res.status).toBe(404);
  });

  it("two plugins claiming one kind refuse the boot by name", async () => {
    const plugins = new PluginHost();
    plugins.use({
      specifier: "a",
      modules: [surfacePlugin("dup", fakeSurface().surface)],
      replaces: [],
    });
    plugins.use({
      specifier: "b",
      modules: [
        {
          ...surfacePlugin("dup", fakeSurface().surface),
          manifest: parseManifest({
            name: "ext-dup-b",
            requires: {},
            provides: {},
            contributes: {
              "SessionSurfacesModule.surfaces": [
                { id: "ext-dup-b.surface", kind: "dup", label: "B", renderer: { builtin: "X" } },
              ],
            },
            children: [],
          }),
          create: () => ({ api: {}, bind: { "ext-dup-b.surface": fakeSurface().surface } }),
        },
      ],
      replaces: [],
    });
    await expect(createTestApp({ plugins })).rejects.toThrow(
      /surface kind 'dup' is contributed twice/,
    );
  });
});

describe("a terminal running a program", () => {
  function manager(): TerminalManager {
    const registry = new Map<string, unknown>();
    return new TerminalManager(
      {
        register: (id, resource, dispose) => {
          registry.set(id, resource);
          return () => {
            if (registry.get(id) !== resource) return;
            registry.delete(id);
            dispose?.();
          };
        },
        claim: <T>(id: string) => registry.get(id) as T | undefined,
      },
      { graceMs: 80 },
    );
  }

  // The two cases below drive a real pty through `/bin/sh`, which Windows has not got. What
  // they pin — an argv spawned as given, an environment the caller pruned — is not
  // platform-specific, and a cmd.exe transliteration would pin the transliteration instead.
  it.skipIf(process.platform === "win32")(
    "spawns the argv as given, with no shell and no login flag",
    async () => {
      const terminals = manager();
      try {
        const session = await terminals.create({
          cwd: os.tmpdir(),
          ownerUserId: "u1",
          command: ["/bin/sh", "-c", "printf surface-%s ok; exit 7"],
        });
        const deadline = Date.now() + 10_000;
        while (session.alive && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 20));
        }
        expect(session.alive).toBe(false);
        expect(session.info().exit?.exitCode).toBe(7);
        expect(session.capture().lines.join("\n")).toContain("surface-ok");
      } finally {
        terminals.disposeAll();
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "does not hand the pty the server's own tmux pane or a caller's named variables",
    async () => {
      // The pty is not a pane of whatever tmux started the server, and a marker the caller
      // names must be absent rather than merely overwritten — a value cannot say "unset".
      process.env.TMUX = "/tmp/tmux-1000/default,123,0";
      process.env.SURFACE_MARKER_PROBE = "inherited";
      const terminals = manager();
      try {
        const session = await terminals.create({
          cwd: os.tmpdir(),
          ownerUserId: "u1",
          command: ["/bin/sh", "-c", 'echo "tmux=[${TMUX:-}] marker=[${SURFACE_MARKER_PROBE:-}]"'],
          unsetEnv: ["SURFACE_MARKER_PROBE"],
        });
        const deadline = Date.now() + 10_000;
        while (session.alive && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 20));
        }
        expect(session.capture().lines.join("\n")).toContain("tmux=[] marker=[]");
      } finally {
        terminals.disposeAll();
        delete process.env.TMUX;
        delete process.env.SURFACE_MARKER_PROBE;
      }
    },
  );

  it("names the program it could not start, not 'a shell'", () => {
    // What a surface hits when its tool is not installed on the machine: the reader must be
    // pointed at the missing program. (Asserted on the message rather than a real spawn:
    // Windows fails a missing program at spawn, POSIX only when the child exits.)
    expect(spawnFailureMessage("claude", new Error("File not found: "), null)).toBe(
      "Could not start claude: File not found: ",
    );
    expect(spawnFailureMessage(undefined, new Error("posix_spawnp failed."), "chmod +x it")).toBe(
      "Could not start a shell: posix_spawnp failed. (chmod +x it)",
    );
  });

  it("refuses an empty argv", async () => {
    const terminals = manager();
    await expect(
      terminals.create({ cwd: os.tmpdir(), ownerUserId: "u1", command: [] }),
    ).rejects.toThrow(/command must name a program/);
  });
});
