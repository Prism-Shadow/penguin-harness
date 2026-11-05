/**
 * Which server the `penguin` typed in a terminal talks to: the server that opened the terminal.
 *
 * The real CLI — this checkout's, run the way a dev server offers it (services/cli-shim.ts) —
 * in a real bash opened over the API, against two stand-in servers that each answer
 * `GET /api/projects` with a name of their own: one on this server's data root, one on another
 * root ("installed"). The server PROCESS's environment points at the other one the ways it can
 * in practice: an inherited PENGUIN_HOME, and the PENGUIN_API_URL / _TOKEN an Agent command of
 * another harness carries, which a dev server that Agent started inherits.
 *
 * - With no flag and nothing the user set, `penguin` in the terminal reaches this server's root.
 * - What the user sets wins: PENGUIN_HOME typed on the command line reaches that root.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCliLaunch } from "../src/services/cli-shim.js";
import { apiClient, createTestApp, loginAdmin, type TestApp } from "./helpers.js";

const PROMPT = "READY>";

function onPath(name: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  return null;
}

const bash = process.platform === "win32" ? null : onPath("bash");

/** This checkout's CLI, as a dev server running from source offers it. */
const cli = resolveCliLaunch({
  explicit: undefined,
  moduleDir: path.dirname(fileURLToPath(import.meta.url)),
  source: true,
  electron: false,
});

/**
 * A server as the CLI finds one: a live lock in `root` (this process's pid, a port that
 * accepts) and an api-token, answering `GET /api/projects` with one project named `name`.
 * Counts what it is asked.
 */
async function standIn(root: string, name: string) {
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url?.startsWith("/api/projects")) {
      res.end(JSON.stringify({ projects: [{ projectId: name, name, role: "owner" }] }));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { code: "not_found", message: "stand-in" } }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "server.lock"),
    `${JSON.stringify({ pid: process.pid, port, startedAt: "now" })}\n`,
  );
  fs.writeFileSync(path.join(root, "api-token"), `${name}-token\n`);
  return {
    url: `http://localhost:${port}`,
    seen,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe.skipIf(bash === null)("a terminal's penguin", () => {
  let tmp: string;
  let t: TestApp | null = null;
  const saved = new Map<string, string | undefined>();
  const setEnv = (key: string, value: string): void => {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    process.env[key] = value;
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-cli-target-"));
    // The server's shells start in this HOME and read only its startup files.
    const home = path.join(tmp, "home");
    fs.mkdirSync(home);
    fs.writeFileSync(
      path.join(home, ".bash_profile"),
      '[ -r "$HOME/.bashrc" ] && . "$HOME/.bashrc"\n',
    );
    fs.writeFileSync(path.join(home, ".bashrc"), `PS1='${PROMPT} '\n`);
    setEnv("HOME", home);
    setEnv("PENGUIN_LANG", "en");
  });

  afterEach(async () => {
    await t?.cleanup();
    t = null;
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    saved.clear();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("reaches the server that opened the terminal, whatever that server's process inherited", async () => {
    t = await createTestApp({
      config: {
        cliEntry: cli.entry,
        cliLaunch: {
          execArgs: cli.execArgs,
          checkout: cli.checkout,
          origin: cli.origin,
          unavailable: cli.unavailable,
        },
      },
    });
    const mine = await standIn(t.root, "this-instance");
    const otherRoot = path.join(tmp, "installed-root");
    const other = await standIn(otherRoot, "installed");
    try {
      // What the server process may carry from whoever started it.
      setEnv("PENGUIN_HOME", otherRoot);
      setEnv("PENGUIN_API_URL", other.url);
      setEnv("PENGUIN_API_TOKEN", "installed-token");

      const admin = await loginAdmin(t.app);
      const api = apiClient(t.app, admin.cookie);
      const created = await api.post("/api/terminals", { cwd: "~", shell: bash, cols: 400 });
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string };
      /** Types `line`, then polls until a screen line is exactly `until` (not the echo of it). */
      const type = async (line: string, until: string): Promise<string[]> => {
        await api.post(`/api/terminals/${id}/keys`, { keys: line, literal: true });
        await api.post(`/api/terminals/${id}/keys`, { keys: "Enter" });
        const deadline = Date.now() + 30_000;
        let lines: string[] = [];
        while (!lines.includes(until) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          const res = await api.get(`/api/terminals/${id}/capture`);
          lines = ((await res.json()) as { lines: string[] }).lines.map((l) => l.trimEnd());
        }
        return lines;
      };

      const plain = await type("penguin project ls --json; echo plain-done", "plain-done");
      expect(plain.join("\n")).toContain('"projectId":"this-instance"');
      expect(other.seen).toEqual([]);
      expect(mine.seen).toContain("GET /api/projects");

      // The user's own choice still wins.
      const chosen = await type(
        `PENGUIN_HOME='${otherRoot}' penguin project ls --json; echo chosen-done`,
        "chosen-done",
      );
      expect(chosen.join("\n")).toContain('"projectId":"installed"');
      expect(other.seen).toContain("GET /api/projects");
    } finally {
      await mine.close();
      await other.close();
    }
  }, 90_000);
});
