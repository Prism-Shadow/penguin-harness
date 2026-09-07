/**
 * The plugin on the real server: installed through plugins.json, loaded by the real
 * loader, its surface offered to the App, and a Session of its kind opened, driven and
 * closed — with a fake `claude` (fake-claude.mjs) standing in through PENGUIN_CLAUDE_BIN.
 *
 * Needs the server and this package built (see README). Skipped on Windows: the fake is a
 * script with a shebang, which a pty there cannot spawn.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultServerEntry,
  startHarness,
  waitFor,
  type Harness,
  type HarnessApi,
} from "@prismshadow/penguin-plugin-test";

const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FAKE_CLAUDE = path.join(PLUGIN_DIR, "test", "fake-claude.mjs");
const SESSIONS = "/api/projects/default_project/agents/default_agent/sessions";

interface SessionInfo {
  sessionId: string;
  status: "idle" | "running" | "compacting";
  surface?: string;
  title?: string;
  hasTrace: boolean;
  workspace: string;
  provider: string;
}
interface SurfaceState {
  kind: string;
  status: string;
  opened: boolean;
  alive: boolean;
  view?: { terminalId?: string };
}

describe.skipIf(process.platform === "win32")("the claude-code plugin on a real server", () => {
  let harness: Harness;
  let api: HarnessApi;

  beforeAll(async () => {
    await fs.access(defaultServerEntry());
    await fs.chmod(FAKE_CLAUDE, 0o755);
    harness = await startHarness({
      plugins: [PLUGIN_DIR],
      env: { PENGUIN_CLAUDE_BIN: FAKE_CLAUDE },
    });
    api = await harness.login();
  }, 90_000);
  afterAll(async () => {
    await harness?.stop();
  });

  it("is loaded, and its surface is what the App is offered", async () => {
    const [row] = await harness.installedPlugins();
    expect(row).toMatchObject({ active: true, modules: ["ClaudeCode"], replaces: [] });
    const contributions = await api.get<{ sessionSurfaces: Array<Record<string, unknown>> }>(
      "/api/contributions",
    );
    expect(contributions.sessionSurfaces).toEqual([
      {
        id: "claude-code.surface",
        from: "ClaudeCode",
        kind: "claude-code",
        label: "Claude Code",
        labelZh: "Claude Code",
        renderer: { builtin: "TerminalSurface" },
      },
    ]);
  });

  it("opens Claude Code in the Workspace, reports its activity, and closes with the Session", async () => {
    const { session } = await api.post<{ session: SessionInfo }>(SESSIONS, {
      surface: "claude-code",
    });
    expect(session.surface).toBe("claude-code");
    expect(session.provider).toBe("");

    const opened = await api.post<SurfaceState>(`/api/sessions/${session.sessionId}/surface`, {
      prompt: "hello there",
    });
    expect(opened).toMatchObject({ kind: "claude-code", opened: true, alive: true });
    const terminalId = opened.view?.terminalId;
    expect(typeof terminalId).toBe("string");
    const terminal = api.terminal(terminalId!);
    // Compared as real paths: macOS hands a pty the resolved `/private/var/...` while the
    // Session names the `/var/...` symlink it was given.
    expect(await fs.realpath((await terminal.info()).cwd)).toBe(
      await fs.realpath(session.workspace),
    );

    // The program got the prompt, and settles at a waiting prompt.
    const screen = await waitFor(
      terminal.capture,
      (lines) => lines.join("\n").includes("fake claude hello there"),
      { what: "the banner" },
    );
    expect(screen.join("\n")).toContain("fake claude hello there");
    const info = () => api.get<{ session: SessionInfo }>(`/api/sessions/${session.sessionId}`);
    const waiting = await waitFor(info, (r) => r.session.status === "idle", { what: "idle" });
    // The prompt named the Session.
    expect(waiting.session.title).toBe("hello there");
    await waitFor(terminal.capture, (lines) => lines.some((l) => l.startsWith(">")), {
      what: "the prompt",
    });

    // Input wakes it, and the state follows the program's own SPINNER LINE — `<glyph> Word…`
    // while the turn is in flight, a past tense with no ellipsis when it ends — not the flow
    // of bytes (the fake draws a different word each turn, as the real one does).
    await terminal.keys("do a thing\n", true);
    const running = await waitFor(info, (r) => r.session.status === "running", {
      what: "running",
    });
    expect(running.session.hasTrace).toBe(true);
    await waitFor(terminal.capture, (lines) => lines.join("\n").includes("done: do a thing"), {
      what: "the answer",
    });
    await waitFor(info, (r) => r.session.status === "idle", { what: "idle again" });

    // Opening again is the same terminal, not a second program.
    const again = await api.post<SurfaceState>(`/api/sessions/${session.sessionId}/surface`, {});
    expect(again.view?.terminalId).toBe(terminalId);

    // The program ending is the surface ending; the Session stays, idle.
    await terminal.keys("exit\n", true);
    const ended = await waitFor(
      () => api.get<SurfaceState>(`/api/sessions/${session.sessionId}/surface`),
      (s) => !s.alive,
      { what: "the program to exit" },
    );
    expect(ended).toMatchObject({ opened: true, alive: false, status: "idle" });

    // Deleting the Session takes its surface; the terminal is gone with it.
    await api.delete(`/api/sessions/${session.sessionId}`);
    await expect(api.get(`/api/sessions/${session.sessionId}/surface`)).rejects.toMatchObject({
      status: 404,
    });
  }, 60_000);
});
