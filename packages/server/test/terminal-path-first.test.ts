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
 * - Given a user rc that puts its own `penguin` first AGAIN after startup — in a prompt hook
 *   (bash PROMPT_COMMAND as a string or an array, zsh precmd) or in zsh's .zlogin —
 *   `command -v penguin` is still the shim, at the first prompt and the next.
 * - The prompt hook keeps the exit status of the user's last command, and the user's settings
 *   as they were: a `set -e` bash survives a failure set -e lets pass, an ERR / ZERR trap runs
 *   once per failed command, a bash started inside the terminal under the user's exported
 *   PROMPT_COMMAND prints no error, and a zsh under `setopt nounset` nothing above its prompt.
 * - zsh: once started, ZDOTDIR is what the user had (unset, or their own), so `exec zsh` and
 *   nested shells read the user's files.
 * - Without a shim directory the shell starts as before, and the user's rc decides `penguin`.
 * - Opening another terminal adds nothing to the startup directory.
 * - The shell gets none of the server process's PENGUIN_* / PORT / HOST, only what the caller
 *   passes — but keeps PENGUIN_HOME / PENGUIN_WEB_DB where no shim names the data root. A
 *   notice, when there is one, is the screen's first line, above the prompt.
 * - Through the server: a terminal opened over the API on a server with a CLI entry runs the
 *   server's `<root>/bin/penguin`; a development instance's terminal first says which CLI that
 *   is and on which data root, or, when the checkout's CLI cannot run, why — and `penguin`
 *   then says the same and fails.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TerminalSession, type TerminalNotice } from "../src/terminal/session.js";
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
    notice: TerminalNotice | null = null,
  ): Promise<TerminalSession> {
    const session = new TerminalSession({
      cwd: tmp,
      ownerUserId: "u1",
      shell: shellPath,
      env,
      pathFirst: first,
      notice,
      // Wide enough that no echoed path wraps onto a second screen line: macOS's temp dirs
      // (/var/folders/…/T/…) run past the default 80 columns, and the assertions read whole lines.
      cols: 400,
    });
    try {
      await waitUntil(
        () => screen(session).some((line) => line.startsWith(PROMPT)),
        () => `no prompt; screen: ${screen(session).join(" | ")}`,
        // PowerShell's first startup can stall on a busy CI runner before emitting a byte.
        path.basename(shellPath) === "pwsh" ? 30_000 : 15_000,
      );
      return session;
    } catch (err) {
      // The caller cannot enter its finally until open returns: release a failed startup here.
      session.dispose();
      throw err;
    }
  }

  /** Types `line` and waits until `done` shows on the screen. */
  async function run(session: TerminalSession, line: string, done: string): Promise<string[]> {
    session.write(`${line}\r`);
    try {
      await waitUntil(
        () => screen(session).includes(done),
        () => `no ${done}`,
        5_000,
      );
    } catch {
      // pwsh on macOS can print its prompt before PSReadLine takes the terminal: the typed
      // line lands in its buffer but the Enter that came with it is lost, and the line sits
      // there unsubmitted. A second Enter submits it; on a shell that already ran it, it is
      // one empty command line.
      session.write("\r");
      await waitUntil(
        () => screen(session).includes(done),
        () => `no ${done}; screen: ${screen(session).join(" | ")}`,
      );
    }
    return screen(session);
  }

  for (const shell of SHELLS) {
    const shellPath = onPath(shell.name);

    describe.skipIf(shellPath === null)(shell.name, () => {
      it(
        "runs the shim's penguin over the user's, keeping the user's alias and PATH entry",
        async () => {
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
        },
        shell.name === "pwsh" ? 60_000 : 30_000,
      );

      it(
        "prints nothing before the user's prompt",
        async () => {
          const { env } = homeFor(shell);
          const session = await open(shellPath!, env, pathFirst());
          try {
            expect(screen(session)).toEqual([PROMPT]);
          } finally {
            session.dispose();
          }
        },
        shell.name === "pwsh" ? 60_000 : 30_000,
      );
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

  /**
   * Users whose startup files put their own `penguin` first once more AFTER startup: in a
   * prompt hook, which runs before every prompt (version managers and environment tools
   * install them), or in zsh's last startup file. Each case's files also do what the rc
   * above does — put the directory first and set the prompt — so only the late re-prepend
   * differs.
   */
  const LATE: Array<{ shell: string; what: string; files: Record<string, string> }> = [
    {
      shell: "bash",
      what: "a PROMPT_COMMAND string",
      files: {
        ".bash_profile": '[ -r "$HOME/.bashrc" ] && . "$HOME/.bashrc"\n',
        ".bashrc": `export PATH="${RC_PATH}:$PATH"\nPS1='${PROMPT} '\n_user_hook() { PATH="${RC_PATH}:$PATH"; }\nPROMPT_COMMAND=_user_hook\n`,
      },
    },
    {
      shell: "bash",
      what: "a PROMPT_COMMAND array",
      files: {
        ".bash_profile": '[ -r "$HOME/.bashrc" ] && . "$HOME/.bashrc"\n',
        ".bashrc": `export PATH="${RC_PATH}:$PATH"\nPS1='${PROMPT} '\n_user_hook() { PATH="${RC_PATH}:$PATH"; }\nPROMPT_COMMAND=(_user_hook)\n`,
      },
    },
    {
      shell: "zsh",
      what: "a precmd hook",
      files: {
        ".zshrc": `export PATH="${RC_PATH}:$PATH"\nPS1='${PROMPT} '\n_user_hook() { path=(${RC_PATH} $path) }\nprecmd_functions+=(_user_hook)\n`,
      },
    },
    {
      shell: "zsh",
      what: ".zlogin",
      files: {
        ".zshrc": `export PATH="${RC_PATH}:$PATH"\nPS1='${PROMPT} '\n`,
        ".zlogin": `path=(${RC_PATH} $path)\n`,
      },
    },
  ];

  /** A fresh HOME with the user's `penguin` in ~/userbin and exactly these startup files. */
  function homeWith(files: Record<string, string>): Record<string, string> {
    const home = fs.mkdtempSync(path.join(tmp, "home-late-"));
    writeScript(path.join(home, "userbin", "penguin"), "echo from-user");
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(home, name), content);
    }
    return { HOME: home, BASH_SILENCE_DEPRECATION_WARNING: "1" };
  }

  /** The line `command -v penguin` printed, read off the screen above the marker after it. */
  async function whichPenguin(session: TerminalSession, marker: string): Promise<string> {
    const lines = await run(session, `command -v penguin; echo ${marker}`, marker);
    return lines[lines.lastIndexOf(marker) - 1] ?? "";
  }

  for (const late of LATE) {
    const shellPath = onPath(late.shell);

    describe.skipIf(shellPath === null)(`${late.shell} with ${late.what} that re-prepends`, () => {
      it("still resolves penguin to the shim, at the first prompt and the next", async () => {
        const session = await open(shellPath!, homeWith(late.files), pathFirst());
        try {
          const shim = path.join(shimDir, "penguin");
          expect(await whichPenguin(session, "first-prompt")).toBe(shim);
          expect(await whichPenguin(session, "next-prompt")).toBe(shim);
          expect(await run(session, "penguin", "from-shim")).not.toContain("from-user");
        } finally {
          session.dispose();
        }
      }, 30_000);
    });
  }

  describe.skipIf(onPath("bash") === null)("the prompt hook", () => {
    it("keeps the exit status of the user's last command", async () => {
      const bash = SHELLS.find((shell) => shell.name === "bash")!;
      const { env } = homeFor(bash);
      const session = await open(onPath("bash")!, env, pathFirst());
      try {
        // Between `false` and the next line bash runs PROMPT_COMMAND, whose last command's
        // status is what `$?` then reads. Typed ahead: the shell reads the lines in order.
        session.write("false\r");
        const lines = await run(session, 'echo "status=$?"', "status=1");
        expect(lines).not.toContain("status=0");
      } finally {
        session.dispose();
      }
    }, 30_000);
  });

  /**
   * The prompt hook runs after every command, at the user's own settings, and leaves them as they
   * were: a hook that failed after a failed command would end a `set -e` bash and run an ERR or
   * ZERR trap a second time; a PROMPT_COMMAND the user exports reaches the bash started inside the
   * terminal, which never defines the hook; zsh sets the hook up under the user's `nounset`.
   */
  describe.skipIf(onPath("bash") === null)("the prompt hook, in a bash the user configured", () => {
    const bashWith = (rc: string): Record<string, string> =>
      homeWith({
        ".bash_profile": '[ -r "$HOME/.bashrc" ] && . "$HOME/.bashrc"\n',
        ".bashrc": `PS1='${PROMPT} '\n${rc}`,
      });

    it("does not end a `set -e` shell after a failure that set -e lets pass", async () => {
      const session = await open(onPath("bash")!, bashWith("set -e\n"), pathFirst());
      try {
        // set -e excuses the failure left of `&&`; a prompt hook failing in turn would not be.
        session.write("false && true\r");
        expect(await run(session, "echo still-here", "still-here")).toContain("still-here");
      } finally {
        session.dispose();
      }
    }, 30_000);

    it("runs the user's ERR trap once for a failed command", async () => {
      const rc = "trap 'echo err-trap' ERR\n";
      const session = await open(onPath("bash")!, bashWith(rc), pathFirst());
      try {
        // Not typed ahead: a line typed while `false` runs is echoed by the terminal at once,
        // and can land inside the trap's own line on a slow machine.
        await run(session, "false", "err-trap");
        const lines = await run(session, "echo done-mark", "done-mark");
        expect(lines.filter((line) => line === "err-trap")).toHaveLength(1);
      } finally {
        session.dispose();
      }
    }, 30_000);

    it("leaves a bash started inside it quiet when the user exports PROMPT_COMMAND", async () => {
      const rc = 'export PROMPT_COMMAND="history -a${PROMPT_COMMAND:+;$PROMPT_COMMAND}"\n';
      const session = await open(onPath("bash")!, bashWith(rc), pathFirst());
      try {
        // The nested bash reads ~/.bashrc, not the terminal's startup file: it inherits what the
        // hook added to PROMPT_COMMAND, but not the function that names.
        session.write("bash\r");
        const lines = await run(session, "echo in-nested", "in-nested");
        expect(lines.filter((line) => line.includes("not found"))).toEqual([]);
      } finally {
        session.dispose();
      }
    }, 30_000);
  });

  describe.skipIf(onPath("zsh") === null)("the prompt hook, in a zsh the user configured", () => {
    const zshWith = (rc: string): Record<string, string> =>
      homeWith({ ".zshrc": `${rc}PS1='${PROMPT} '\n` });

    it("prints nothing above the prompt under `setopt nounset`, and still leads PATH", async () => {
      const session = await open(onPath("zsh")!, zshWith("setopt nounset\n"), pathFirst());
      try {
        expect(screen(session)).toEqual([PROMPT]);
        expect(await whichPenguin(session, "nounset-done")).toBe(path.join(shimDir, "penguin"));
      } finally {
        session.dispose();
      }
    }, 30_000);

    it("runs the user's ZERR trap once for a failed command", async () => {
      const rc = "TRAPZERR() { print zerr-trap }\n";
      const session = await open(onPath("zsh")!, zshWith(rc), pathFirst());
      try {
        // Not typed ahead, as in bash's case above.
        await run(session, "false", "zerr-trap");
        const lines = await run(session, "echo done-mark", "done-mark");
        expect(lines.filter((line) => line === "zerr-trap")).toHaveLength(1);
      } finally {
        session.dispose();
      }
    }, 30_000);
  });

  describe.skipIf(onPath("bash") === null)("the shell's environment", () => {
    const bash = SHELLS.find((shell) => shell.name === "bash")!;
    /** What the server process carries: its own wiring, and context from whoever started it. */
    const SERVER_ONLY = {
      PENGUIN_HOME: "/srv/penguin-root",
      PENGUIN_WEB_DB: "/srv/penguin.db",
      PENGUIN_API_URL: "http://localhost:1",
      PENGUIN_CLI_ENTRY: "/opt/other/penguin.js",
      PORT: "7368",
      HOST: "127.0.0.1",
    };
    /** And the user's own settings, which reach the server the same way (a Windows `setx`). */
    const USER_OWN = { PENGUIN_LANG: "zh", PENGUIN_UPDATE_CHECK: "off" };
    const SERVER_ENV = { ...SERVER_ONLY, ...USER_OWN };

    /**
     * Opens bash with SERVER_ENV in this process's environment and `extra` passed by the
     * caller; waits for exactly the line `expected` describes, so anything else shows up on
     * the screen in the timeout's message.
     */
    async function shellSees(
      options: { inheritDataRoot?: boolean },
      expected: Record<string, string>,
    ): Promise<string[]> {
      const saved = Object.fromEntries(Object.keys(SERVER_ENV).map((k) => [k, process.env[k]]));
      Object.assign(process.env, SERVER_ENV);
      try {
        const { env } = homeFor(bash);
        const session = new TerminalSession({
          cwd: tmp,
          ownerUserId: "u1",
          shell: onPath("bash")!,
          env: { ...env, PENGUIN_GIVEN: "given" },
          cols: 400,
          ...options,
        });
        try {
          await waitUntil(
            () => screen(session).some((line) => line.startsWith(PROMPT)),
            () => `no prompt; screen: ${screen(session).join(" | ")}`,
          );
          const keys = [...Object.keys(SERVER_ENV), "PENGUIN_GIVEN"];
          const probe = keys.map((k) => `${k}=\${${k}-unset}`).join(" ");
          const line = keys.map((k) => `${k}=${expected[k] ?? "unset"}`).join(" ");
          const lines = await run(session, `echo "${probe}"`, line);
          expect(lines).toContain(line);
          return lines;
        } finally {
          session.dispose();
        }
      } finally {
        for (const [k, v] of Object.entries(saved)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      }
    }

    it("has none of the server process's PENGUIN_* / PORT / HOST but the user's own settings, and what the caller passes", async () => {
      await shellSees({}, { ...USER_OWN, PENGUIN_GIVEN: "given" });
    }, 30_000);

    it("keeps the server's PENGUIN_HOME / PENGUIN_WEB_DB where no shim names the data root", async () => {
      await shellSees(
        { inheritDataRoot: true },
        {
          PENGUIN_HOME: SERVER_ONLY.PENGUIN_HOME,
          PENGUIN_WEB_DB: SERVER_ONLY.PENGUIN_WEB_DB,
          ...USER_OWN,
          PENGUIN_GIVEN: "given",
        },
      );
    }, 30_000);
  });

  describe.skipIf(onPath("bash") === null)("a notice", () => {
    it("is the screen's first line, and the user's prompt follows it", async () => {
      const bash = SHELLS.find((shell) => shell.name === "bash")!;
      const { env } = homeFor(bash);
      const notice: TerminalNotice = { text: "a word before the prompt", tone: "info" };
      const session = await open(onPath("bash")!, env, pathFirst(), notice);
      try {
        expect(screen(session)).toEqual([notice.text, PROMPT]);
      } finally {
        session.dispose();
      }
    }, 30_000);
  });

  /**
   * A HOME whose startup file for `shell` exports `vars` and sets the prompt, and the
   * environment that points the shell at it.
   */
  function homeExporting(shell: string, vars: Record<string, string>): Record<string, string> {
    const home = fs.mkdtempSync(path.join(tmp, `home-${shell}-vars-`));
    const write = (rel: string, lines: string[]): void => {
      fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
      fs.writeFileSync(path.join(home, rel), [...lines, ""].join("\n"));
    };
    const entries = Object.entries(vars);
    const posix = [...entries.map(([k, v]) => `export ${k}='${v}'`), `PS1='${PROMPT} '`];
    if (shell === "bash") write(".bash_profile", posix);
    if (shell === "zsh") write(".zshrc", posix);
    if (shell === "dash") write(".profile", posix);
    if (shell === "fish") {
      write(".config/fish/config.fish", [
        "set -g fish_greeting ''",
        ...entries.map(([k, v]) => `set -gx ${k} '${v}'`),
        `function fish_prompt; echo -n '${PROMPT} '; end`,
      ]);
    }
    if (shell === "pwsh") {
      write(".config/powershell/Microsoft.PowerShell_profile.ps1", [
        ...entries.map(([k, v]) => `$env:${k} = '${v}'`),
        `function prompt { '${PROMPT} ' }`,
      ]);
    }
    return {
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      XDG_DATA_HOME: path.join(home, ".local", "share"),
      XDG_CACHE_HOME: path.join(home, ".cache"),
      BASH_SILENCE_DEPRECATION_WARNING: "1",
      POWERSHELL_UPDATECHECK: "Off",
      POWERSHELL_TELEMETRY_OPTOUT: "1",
    };
  }

  /**
   * A development instance's first line, which the shell prints itself at its first prompt,
   * once the user's startup files have run: the line as given while `penguin` there still
   * targets this instance, and what it targets instead when those files set PENGUIN_API_URL or
   * another PENGUIN_HOME.
   */
  describe("a development instance's first line", () => {
    const ROOT = path.join(path.sep, "instance", "root");
    const devNotice: TerminalNotice = {
      text: "the CLI of this instance, on its data root",
      tone: "info",
      target: { root: ROOT, elsewhere: ["Your shell sets ", ", so not this instance."] },
    };
    const CASES: Array<{ what: string; vars: Record<string, string>; first: string }> = [
      { what: "nothing", vars: {}, first: devNotice.text },
      {
        what: "PENGUIN_HOME to another root",
        vars: { PENGUIN_HOME: "/somewhere/else" },
        first: "Your shell sets PENGUIN_HOME=/somewhere/else, so not this instance.",
      },
      {
        what: "PENGUIN_HOME to this root",
        vars: { PENGUIN_HOME: `${ROOT}/` },
        first: devNotice.text,
      },
      {
        what: "PENGUIN_API_URL",
        vars: { PENGUIN_API_URL: "http://localhost:9" },
        first: "Your shell sets PENGUIN_API_URL=http://localhost:9, so not this instance.",
      },
    ];

    for (const shell of ["bash", "zsh", "dash", "fish", "pwsh"]) {
      const shellPath = onPath(shell);
      it.skipIf(shellPath === null)(
        `${shell}: says what the user's own files leave penguin aimed at`,
        async () => {
          for (const c of CASES) {
            const session = await open(
              shellPath!,
              homeExporting(shell, c.vars),
              pathFirst(),
              devNotice,
            );
            try {
              expect(screen(session), `when they set ${c.what}`).toEqual([c.first, PROMPT]);
            } finally {
              session.dispose();
            }
          }
        },
        60_000,
      );
    }

    it.skipIf(onPath("zsh") === null)(
      "zsh: waits for an instant prompt to hand the terminal back",
      async () => {
        // What powerlevel10k's instant prompt does: standard output goes to a file from the top
        // of .zshrc until a `sched +0` that its first prompt hook sets up, which then prints
        // whatever was captured as "console output during initialization".
        const env = homeExporting("zsh", {});
        fs.writeFileSync(
          path.join(env.HOME!, ".zshrc"),
          [
            "zmodload zsh/sched",
            "_cap=$HOME/captured",
            "exec {_po}>&1 {_pe}>&2 1>$_cap 2>&1",
            '_release() { exec 1>&$_po 2>&$_pe; [[ -s $_cap ]] && print -r -- "captured: $(<$_cap)"; return 0 }',
            "_first() { precmd_functions=(${precmd_functions:#_first}); sched +0 _release }",
            "precmd_functions=(_first $precmd_functions)",
            `PS1='${PROMPT} '`,
            "",
          ].join("\n"),
        );
        const session = await open(onPath("zsh")!, env, pathFirst(), devNotice);
        try {
          expect(screen(session)).toEqual([devNotice.text, PROMPT]);
        } finally {
          session.dispose();
        }
      },
      30_000,
    );
  });

  /**
   * A prompt hook that puts the user's `penguin` first, registered only at the second prompt —
   * what a lazy plugin loader does — runs after ours unless ours moves behind it again. From
   * the second prompt on `penguin` stays the shim's, and nothing piles up in the hook lists.
   */
  const DEFERRED: Array<{ shell: string; what: string; home: (home: string) => void }> = [
    {
      shell: "bash",
      what: "a string PROMPT_COMMAND",
      home: (home) =>
        fs.writeFileSync(
          path.join(home, ".bash_profile"),
          [
            `PS1='${PROMPT} '`,
            "_n=0",
            '_late() { PATH="$HOME/userbin:$PATH"; }',
            `_defer() { _n=$((_n + 1)); if [ "$_n" = 2 ]; then PROMPT_COMMAND="$PROMPT_COMMAND"$'\\n'_late; fi; }`,
            "PROMPT_COMMAND=_defer",
            "",
          ].join("\n"),
        ),
    },
    {
      shell: "zsh",
      what: "precmd_functions",
      home: (home) =>
        fs.writeFileSync(
          path.join(home, ".zshrc"),
          [
            `PS1='${PROMPT} '`,
            "typeset -gi _n=0",
            "_late() { path=($HOME/userbin $path) }",
            "_defer() { (( ++_n == 2 )) && precmd_functions+=(_late); return 0 }",
            "precmd_functions+=(_defer)",
            "",
          ].join("\n"),
        ),
    },
    {
      shell: "fish",
      what: "a fish_prompt handler",
      home: (home) => {
        const config = path.join(home, ".config", "fish", "config.fish");
        fs.mkdirSync(path.dirname(config), { recursive: true });
        fs.writeFileSync(
          config,
          [
            "set -g fish_greeting ''",
            `function fish_prompt; echo -n '${PROMPT} '; end`,
            "set -g _n 0",
            "function _defer --on-event fish_prompt",
            "  set -g _n (math $_n + 1)",
            "  if test $_n -eq 2",
            "    function _late --on-event fish_prompt; set -gx PATH $HOME/userbin $PATH; end",
            "  end",
            "end",
            "",
          ].join("\n"),
        );
      },
    },
  ];
  /** bash 5.1 and later run every element of an array PROMPT_COMMAND. */
  const bashArrays =
    onPath("bash") !== null &&
    spawnSync(onPath("bash")!, ["-c", "((BASH_VERSINFO[0]*100+BASH_VERSINFO[1] >= 501))"])
      .status === 0;
  if (bashArrays) {
    DEFERRED.push({
      shell: "bash",
      what: "an array PROMPT_COMMAND",
      home: (home) =>
        fs.writeFileSync(
          path.join(home, ".bash_profile"),
          [
            `PS1='${PROMPT} '`,
            "_n=0",
            '_late() { PATH="$HOME/userbin:$PATH"; }',
            '_defer() { _n=$((_n + 1)); if [ "$_n" = 2 ]; then PROMPT_COMMAND+=(_late); fi; }',
            "PROMPT_COMMAND=(_defer)",
            "",
          ].join("\n"),
        ),
    });
  }

  for (const deferred of DEFERRED) {
    const shellPath = onPath(deferred.shell);
    describe.skipIf(shellPath === null)(`${deferred.shell} with ${deferred.what}`, () => {
      it("keeps penguin the shim's when a hook that puts another first is added at the second prompt", async () => {
        const env = homeWith({});
        deferred.home(env.HOME!);
        const session = await open(
          shellPath!,
          { ...env, XDG_CONFIG_HOME: path.join(env.HOME!, ".config") },
          pathFirst(),
        );
        try {
          // Each line runs after the hooks of the prompt it is typed at: the hook is added at
          // the second, and runs from the third on.
          const shim = path.join(shimDir, "penguin");
          for (const prompt of ["first", "second", "third", "fourth"]) {
            expect(await whichPenguin(session, `at-${prompt}-prompt`), prompt).toBe(shim);
          }
          // The hook lists hold what they held a prompt earlier: nothing is added per prompt.
          const size =
            deferred.shell === "bash"
              ? 'echo "size=${#PROMPT_COMMAND[@]}/${#PROMPT_COMMAND}"'
              : deferred.shell === "zsh"
                ? 'echo "size=${#precmd_functions}"'
                : 'echo "size="(count (functions --handlers-type generic))';
          const before = await run(session, `${size}; echo size-a`, "size-a");
          const after = await run(session, `${size}; echo size-b`, "size-b");
          const sizes = (lines: string[], marker: string) => lines[lines.lastIndexOf(marker) - 1];
          expect(sizes(after, "size-b")).toBe(sizes(before, "size-a"));
        } finally {
          session.dispose();
        }
      }, 30_000);
    });
  }
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

  /**
   * A throwaway HOME for one test: the server's shells start in it and read only its startup
   * files, which set the prompt and nothing else — not the startup files of whoever runs the
   * suite. Apple's bash is told not to print its zsh advice, as a user who keeps bash has: the
   * shell prints a development instance's first line at its first prompt, after anything it
   * prints itself on the way there.
   */
  async function withHome(fn: () => Promise<void>): Promise<void> {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-term-home-"));
    fs.writeFileSync(
      path.join(home, ".bash_profile"),
      '[ -r "$HOME/.bashrc" ] && . "$HOME/.bashrc"\n',
    );
    fs.writeFileSync(path.join(home, ".bashrc"), `PS1='${PROMPT} '\n`);
    const saved = { HOME: process.env.HOME, quiet: process.env.BASH_SILENCE_DEPRECATION_WARNING };
    process.env.HOME = home;
    process.env.BASH_SILENCE_DEPRECATION_WARNING = "1";
    try {
      await fn();
    } finally {
      if (saved.HOME === undefined) delete process.env.HOME;
      else process.env.HOME = saved.HOME;
      if (saved.quiet === undefined) delete process.env.BASH_SILENCE_DEPRECATION_WARNING;
      else process.env.BASH_SILENCE_DEPRECATION_WARNING = saved.quiet;
      fs.rmSync(home, { recursive: true, force: true });
    }
  }

  /** Opens a wide bash over the API; types `line`, if any; polls the screen until `until`. */
  async function terminalOf(app: Awaited<ReturnType<typeof createTestApp>>["app"]) {
    const admin = await loginAdmin(app);
    const api = apiClient(app, admin.cookie);
    const created = await api.post("/api/terminals", { cwd: "~", shell: bash, cols: 400 });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    return async (line: string | null, until: (lines: string[]) => boolean): Promise<string[]> => {
      if (line !== null) {
        await api.post(`/api/terminals/${id}/keys`, { keys: line, literal: true });
        await api.post(`/api/terminals/${id}/keys`, { keys: "Enter" });
      }
      const deadline = Date.now() + 15_000;
      let lines: string[] = [];
      while (!until(lines) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const res = await api.get(`/api/terminals/${id}/capture`);
        lines = ((await res.json()) as { lines: string[] }).lines
          .map((l) => l.trimEnd())
          .filter((l) => l !== "");
      }
      return lines;
    };
  }

  it.skipIf(bash === null)(
    "on a dev instance, says first which penguin it runs, and runs it on this server's data root",
    () =>
      withHome(async () => {
        const entryDir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-cli-entry-"));
        const entry = path.join(entryDir, "penguin.mjs");
        fs.writeFileSync(
          entry,
          'console.log(`penguin-home=${process.env.PENGUIN_HOME ?? "unset"}`);\n',
        );
        const checkout = path.join(entryDir, "checkout");
        const t = await createTestApp({
          config: {
            cliEntry: entry,
            cliLaunch: { execArgs: [], checkout, origin: "build", unavailable: null },
          },
        });
        try {
          const term = await terminalOf(t.app);
          const opened = await term(null, (lines) => lines.some((l) => l.startsWith(PROMPT)));
          expect(opened[0]).toContain(`the CLI of ${checkout} (built)`);
          expect(opened[0]).toContain(`on data root ${t.root}`);
          // The shell itself is not handed the root: only the `penguin` the shim starts is.
          const ran = await term('penguin; echo "shell-home=${PENGUIN_HOME-unset}"', (lines) =>
            lines.includes("shell-home=unset"),
          );
          expect(ran).toContain(`penguin-home=${t.root}`);
          expect(ran).toContain("shell-home=unset");
        } finally {
          await t.cleanup();
          fs.rmSync(entryDir, { recursive: true, force: true });
        }
      }),
    30_000,
  );

  it.skipIf(bash === null)(
    "when the checkout's CLI cannot run, says why first, and `penguin` fails saying it too",
    () =>
      withHome(async () => {
        const reason =
          "packages/cli/dist/penguin.js is not built in /work/penguin-harness. Run " +
          "`pnpm --filter @prismshadow/penguin-cli build`, then restart the server.";
        const logs: string[] = [];
        const t = await createTestApp({
          log: (line) => logs.push(line),
          config: {
            cliEntry: null,
            cliLaunch: {
              execArgs: [],
              checkout: "/work/penguin-harness",
              origin: null,
              unavailable: reason,
            },
          },
        });
        try {
          expect(logs.some((line) => line.includes("cannot run") && line.includes(reason))).toBe(
            true,
          );
          const term = await terminalOf(t.app);
          const opened = await term(null, (lines) => lines.some((l) => l.startsWith(PROMPT)));
          expect(opened[0]).toContain(reason);
          const ran = await term('penguin --version; echo "rc=$?"', (lines) =>
            lines.some((l) => l.startsWith("rc=")),
          );
          expect(ran).toContain("rc=1");
          expect(ran.some((l) => l.includes(`cannot run its own CLI: ${reason}`))).toBe(true);
        } finally {
          await t.cleanup();
        }
      }),
    30_000,
  );
});
