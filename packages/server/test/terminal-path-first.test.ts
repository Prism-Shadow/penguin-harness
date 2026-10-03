/**
 * A terminal's `penguin` is this harness's own: the CLI shim directory leads PATH once the
 * user's own startup files have run (src/terminal/shell-startup.ts).
 *
 * Real shells in real ptys, each against a fake HOME whose startup files do what users' do:
 * put their own bin directory (holding another `penguin`) first on PATH, define an alias,
 * set the prompt. Every shell installed on this machine is tried; the others are skipped.
 * The fake executables are `#!/bin/sh` scripts, so nothing depends on where `node` is.
 *
 * - Given a user rc that puts its own `penguin` first, `penguin` typed in the terminal runs
 *   the shim's.
 * - The user's rc still counts: its alias works, and its directory is still on PATH.
 * - Nothing is printed before the user's prompt: no echoed command, no error.
 * - zsh: once started, ZDOTDIR is what the user had (unset, or their own), so `exec zsh` and
 *   nested shells read the user's files.
 * - Without a shim directory the shell starts as before, and the user's rc decides `penguin`.
 * - Opening another terminal adds nothing to the startup directory.
 * - Through the server: a terminal opened over the API on a server with a CLI entry runs the
 *   server's `<root>/bin/penguin`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TerminalSession } from "../src/terminal/session.js";
import { shellStartupDir, type TerminalPathFirst } from "../src/terminal/shell-startup.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";

/** Real ptys only on POSIX, as in terminal.test.ts. */
const describePty = describe.skipIf(process.platform === "win32");

const PROMPT = "READY>";

/** The absolute path of `name` on this process's PATH, or null. */
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

function writeScript(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(file, 0o755);
}

function waitUntil(cond: () => boolean, what: () => string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = (): void => {
      if (cond()) return resolve();
      if (Date.now() > deadline) return reject(new Error(`timed out: ${what()}`));
      setTimeout(poll, 50);
    };
    poll();
  });
}

/** The screen's non-blank lines, right-trimmed. */
function screen(session: TerminalSession): string[] {
  return session
    .capture()
    .lines.map((line) => line.trimEnd())
    .filter((line) => line !== "");
}

interface Shell {
  name: string;
  /** Writes the user's startup files into `home`; returns extra environment entries. */
  user(home: string): Record<string, string>;
}

/** What every user rc below does: its own `penguin` first, an alias, a prompt. */
const RC_PATH = "$HOME/userbin";

const SHELLS: Shell[] = [
  {
    name: "bash",
    user(home) {
      // The common layout: the login profile sources ~/.bashrc, which holds the rest.
      fs.writeFileSync(
        path.join(home, ".bash_profile"),
        '[ -r "$HOME/.bashrc" ] && . "$HOME/.bashrc"\n',
      );
      fs.writeFileSync(
        path.join(home, ".bashrc"),
        `export PATH="${RC_PATH}:$PATH"\nalias pa='echo alias-ok'\nPS1='${PROMPT} '\n`,
      );
      return {};
    },
  },
  {
    name: "zsh",
    user(home) {
      fs.writeFileSync(
        path.join(home, ".zshrc"),
        `export PATH="${RC_PATH}:$PATH"\nalias pa='echo alias-ok'\nPS1='${PROMPT} '\n`,
      );
      return {};
    },
  },
  {
    name: "fish",
    user(home) {
      const config = path.join(home, ".config", "fish", "config.fish");
      fs.mkdirSync(path.dirname(config), { recursive: true });
      fs.writeFileSync(
        config,
        [
          "set -g fish_greeting ''",
          `set -gx PATH ${RC_PATH} $PATH`,
          "alias pa 'echo alias-ok'",
          `function fish_prompt; echo -n '${PROMPT} '; end`,
          "",
        ].join("\n"),
      );
      return {};
    },
  },
  {
    name: "pwsh",
    user(home) {
      const profile = path.join(home, ".config", "powershell", "Microsoft.PowerShell_profile.ps1");
      fs.mkdirSync(path.dirname(profile), { recursive: true });
      fs.writeFileSync(
        profile,
        [
          '$env:PATH = "$HOME/userbin" + [IO.Path]::PathSeparator + $env:PATH',
          "function pa { 'alias-ok' }",
          `function prompt { '${PROMPT} ' }`,
          "",
        ].join("\n"),
      );
      // What a user who never wants the update notice or the telemetry banner has set.
      return { POWERSHELL_UPDATECHECK: "Off", POWERSHELL_TELEMETRY_OPTOUT: "1" };
    },
  },
  {
    name: "dash",
    user(home) {
      fs.writeFileSync(
        path.join(home, ".profile"),
        `PATH="${RC_PATH}:$PATH"; export PATH\nalias pa='echo alias-ok'\nPS1='${PROMPT} '\n`,
      );
      return {};
    },
  },
];

describePty("a terminal puts this harness's penguin first on PATH", () => {
  let tmp: string;
  let shimDir: string;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-terminal-path-"));
    shimDir = path.join(tmp, "root", "bin");
    writeScript(path.join(shimDir, "penguin"), "echo from-shim");
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  /**
   * A fresh HOME for one shell: the user's startup files plus `~/userbin`, which holds the
   * user's own `penguin` and a tool only that directory has.
   */
  function homeFor(shell: Shell): { home: string; env: Record<string, string> } {
    const home = fs.mkdtempSync(path.join(tmp, `home-${shell.name}-`));
    writeScript(path.join(home, "userbin", "penguin"), "echo from-user");
    writeScript(path.join(home, "userbin", "user-tool"), "echo user-tool-ok");
    const extra = shell.user(home);
    return {
      home,
      env: {
        HOME: home,
        // fish keeps its configuration, history and universal variables under these.
        XDG_CONFIG_HOME: path.join(home, ".config"),
        XDG_DATA_HOME: path.join(home, ".local", "share"),
        XDG_CACHE_HOME: path.join(home, ".cache"),
        // Apple's bash warns about zsh on every start unless the user has silenced it.
        BASH_SILENCE_DEPRECATION_WARNING: "1",
        ...extra,
      },
    };
  }

  const pathFirst = (): TerminalPathFirst => ({
    dirs: [shimDir],
    startupDir: shellStartupDir(path.join(tmp, "root")),
  });

  /** Starts `shell` and waits for the user's prompt. */
  async function open(
    shellPath: string,
    env: Record<string, string>,
    first: TerminalPathFirst | null,
  ): Promise<TerminalSession> {
    const session = new TerminalSession({
      cwd: tmp,
      ownerUserId: "u1",
      shell: shellPath,
      env,
      pathFirst: first,
    });
    await waitUntil(
      () => screen(session).some((line) => line.startsWith(PROMPT)),
      () => `no prompt; screen: ${screen(session).join(" | ")}`,
    );
    return session;
  }

  /** Types `line` and waits until `done` shows on the screen. */
  async function run(session: TerminalSession, line: string, done: string): Promise<string[]> {
    session.write(`${line}\r`);
    await waitUntil(
      () => screen(session).includes(done),
      () => `no ${done}; screen: ${screen(session).join(" | ")}`,
    );
    return screen(session);
  }

  for (const shell of SHELLS) {
    const shellPath = onPath(shell.name);

    describe.skipIf(shellPath === null)(shell.name, () => {
      it("runs the shim's penguin over the user's, keeping the user's alias and PATH entry", async () => {
        const { env } = homeFor(shell);
        const session = await open(shellPath!, env, pathFirst());
        try {
          const lines = await run(session, "penguin; pa; user-tool", "user-tool-ok");
          expect(lines).toContain("from-shim");
          expect(lines).not.toContain("from-user");
          expect(lines).toContain("alias-ok");
        } finally {
          session.dispose();
        }
      }, 30_000);

      it("prints nothing before the user's prompt", async () => {
        const { env } = homeFor(shell);
        const session = await open(shellPath!, env, pathFirst());
        try {
          expect(screen(session)).toEqual([PROMPT]);
        } finally {
          session.dispose();
        }
      }, 30_000);
    });
  }

  describe.skipIf(onPath("zsh") === null)("zsh's ZDOTDIR", () => {
    const zsh = SHELLS.find((shell) => shell.name === "zsh")!;

    it("is unset again once started, when the user had none", async () => {
      const { env } = homeFor(zsh);
      const session = await open(onPath("zsh")!, env, pathFirst());
      try {
        const lines = await run(session, 'echo "zd=${ZDOTDIR-unset}"', "zd=unset");
        expect(lines).toContain("zd=unset");
      } finally {
        session.dispose();
      }
    }, 30_000);

    it("is the user's own once started, and their files there are the ones that run", async () => {
      const { home, env } = homeFor(zsh);
      // The same startup files, moved to where this user keeps them.
      const zdot = path.join(home, "zdot");
      fs.mkdirSync(zdot);
      fs.renameSync(path.join(home, ".zshrc"), path.join(zdot, ".zshrc"));
      const session = await open(onPath("zsh")!, { ...env, ZDOTDIR: zdot }, pathFirst());
      try {
        const lines = await run(session, 'echo "zd=$ZDOTDIR"; penguin; pa', "alias-ok");
        expect(lines).toContain(`zd=${zdot}`);
        expect(lines).toContain("from-shim");
      } finally {
        session.dispose();
      }
    }, 30_000);
  });

  describe.skipIf(onPath("bash") === null)("without a shim directory", () => {
    const bash = SHELLS.find((shell) => shell.name === "bash")!;

    it("starts the shell as before: the user's rc decides which penguin runs", async () => {
      const { env } = homeFor(bash);
      const session = await open(onPath("bash")!, env, null);
      try {
        const lines = await run(session, "penguin; pa", "alias-ok");
        expect(lines).toContain("from-user");
      } finally {
        session.dispose();
      }
    }, 30_000);
  });

  describe.skipIf(onPath("bash") === null)("the startup directory", () => {
    const bash = SHELLS.find((shell) => shell.name === "bash")!;

    it("gains nothing when another terminal opens", async () => {
      const { env } = homeFor(bash);
      const first = await open(onPath("bash")!, env, pathFirst());
      first.dispose();
      const dir = pathFirst().startupDir;
      const before = fs.readdirSync(dir, { recursive: true }).sort();
      const second = await open(onPath("bash")!, env, pathFirst());
      second.dispose();
      expect(fs.readdirSync(dir, { recursive: true }).sort()).toEqual(before);
    }, 30_000);
  });
});

describePty("a terminal opened through the server", () => {
  const bash = onPath("bash");

  it.skipIf(bash === null)(
    "runs the server's own penguin, from <root>/bin",
    async () => {
      const entryDir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-cli-entry-"));
      const entry = path.join(entryDir, "penguin.mjs");
      fs.writeFileSync(entry, 'console.log("from-harness-cli");\n');
      const t = await createTestApp({ config: { cliEntry: entry } });
      try {
        const admin = await loginAdmin(t.app);
        const api = apiClient(t.app, admin.cookie);
        const created = await api.post("/api/terminals", { cwd: "~", shell: bash });
        expect(created.status).toBe(201);
        const { id } = (await created.json()) as { id: string };
        await api.post(`/api/terminals/${id}/keys`, { keys: "penguin", literal: true });
        await api.post(`/api/terminals/${id}/keys`, { keys: "Enter" });

        // Polls the screen until the CLI has answered, or the deadline passes.
        const deadline = Date.now() + 15_000;
        let lines: string[] = [];
        while (!lines.includes("from-harness-cli") && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          const res = await api.get(`/api/terminals/${id}/capture`);
          lines = ((await res.json()) as { lines: string[] }).lines.map((line) => line.trimEnd());
        }
        expect(lines).toContain("from-harness-cli");
      } finally {
        await t.cleanup();
        fs.rmSync(entryDir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
