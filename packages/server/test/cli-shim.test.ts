/**
 * The `<root>/bin/penguin` shim a boot writes so an Agent's commands, and this server's
 * terminals, reach this harness's own CLI talking to this harness: what goes into the launcher
 * scripts, which CLI a server offers, when the shim is a stub that says why there is none, and
 * which data root a `penguin` started through it targets.
 *
 * - The launcher runs the server's own interpreter on the entry (loader options first, for a
 *   source run) and names the server's data root — and its database, when that is not the
 *   root's own — unless the caller set PENGUIN_HOME.
 * - A server offers PENGUIN_CLI_ENTRY when set; else, from a checkout, the checkout's CLI —
 *   its source while the server itself runs from source, its build otherwise, each falling back
 *   to the other; Electron has the build only. A checkout with neither gets a stub that says why.
 * - Through the shim, the real CLI's data root is `--root` > an explicit PENGUIN_HOME > the
 *   shim's root; without the shim, `~/.penguin/data` as before.
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cliShimDir,
  ensureCliShim,
  posixShimScript,
  posixStubScript,
  resolveCliLaunch,
  windowsShimScript,
  windowsStubScript,
  workspaceRoot,
} from "../src/services/cli-shim.js";
import { makeTempRoot } from "./helpers.js";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await makeTempRoot();
  roots.push(root);
  return root;
}

afterEach(async () => {
  while (roots.length > 0) {
    await fs.promises.rm(roots.pop()!, { recursive: true, force: true, maxRetries: 10 });
  }
});

/**
 * POSIX permission bits are a POSIX fact: on win32 `chmod` only toggles the read-only
 * attribute and `stat().mode` never reports an execute bit, so an `x`-bit assertion there
 * says nothing about either the code or the platform. What the shim CONTAINS is asserted
 * everywhere; whether it is marked executable — and what running it does — is asserted where
 * a POSIX shell runs it.
 */
const POSIX = process.platform !== "win32";

const LINUX = { execPath: "/usr/bin/node", electron: false, platform: "linux" } as const;

describe("the launcher scripts", () => {
  it("exec the server's own interpreter on the entry, forwarding every argument", () => {
    const script = posixShimScript({
      root: "/data",
      execPath: "/usr/bin/node",
      entry: "/repo/packages/cli/dist/penguin.js",
      electron: false,
    });
    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
    expect(script).toContain(`exec '/usr/bin/node' '/repo/packages/cli/dist/penguin.js' "$@"`);
    expect(script).not.toContain("ELECTRON_RUN_AS_NODE");
  });

  it("put a source run's loader options between the interpreter and the entry", () => {
    const script = posixShimScript({
      root: "/data",
      execPath: "/usr/bin/node",
      execArgs: ["--import", "file:///repo/node_modules/tsx/dist/loader.mjs"],
      entry: "/repo/packages/cli/src/penguin.ts",
      electron: false,
    });
    expect(script).toContain(
      `exec '/usr/bin/node' '--import' 'file:///repo/node_modules/tsx/dist/loader.mjs' ` +
        `'/repo/packages/cli/src/penguin.ts' "$@"`,
    );
  });

  it("set ELECTRON_RUN_AS_NODE when the interpreter is an Electron binary", () => {
    // Under the desktop app the server IS Electron: without the flag the shim would boot a
    // second copy of the app instead of running the CLI.
    const script = posixShimScript({
      root: "/data",
      execPath: "/Applications/P.app/Contents/MacOS/P",
      entry: "/app/penguin.js",
      electron: true,
    });
    expect(script).toContain("export ELECTRON_RUN_AS_NODE=1");
    expect(script.indexOf("ELECTRON_RUN_AS_NODE")).toBeLessThan(script.indexOf("exec "));
  });

  it("quote paths that carry a shell metacharacter", () => {
    const script = posixShimScript({
      root: "/home/anne's data",
      execPath: "/usr/bin/node",
      entry: "/home/anne's data/penguin.js",
      electron: false,
    });
    expect(script).toContain(`'/home/anne'\\''s data/penguin.js'`);
    expect(script).toContain(`PENGUIN_HOME='/home/anne'\\''s data'`);
  });

  it("the Windows half is CRLF, keeps a caller's PENGUIN_HOME, and doubles a %", () => {
    const script = windowsShimScript({
      root: "C:\\data 100%",
      database: "D:\\db\\web.db",
      execPath: "C:\\node.exe",
      execArgs: ["--import", "file:///C:/repo/loader.mjs"],
      entry: "C:\\app\\penguin.js",
      electron: false,
    });
    expect(script.startsWith("@echo off\r\n")).toBe(true);
    expect(script).toContain(`if not defined PENGUIN_HOME set "PENGUIN_HOME=C:\\data 100%%"`);
    // Before PENGUIN_HOME is set, while "not defined" still means "the caller set none".
    const database = `if not defined PENGUIN_HOME set "PENGUIN_WEB_DB=D:\\db\\web.db"`;
    expect(script.indexOf(database)).toBeGreaterThan(-1);
    expect(script.indexOf(database)).toBeLessThan(script.indexOf('set "PENGUIN_HOME='));
    expect(script).toContain(
      `"C:\\node.exe" "--import" "file:///C:/repo/loader.mjs" "C:\\app\\penguin.js" %*`,
    );
    expect(script).toContain("exit /b %errorlevel%");
    expect(script.includes("\n\r")).toBe(false);
  });

  it("the Windows stub escapes what cmd would read as syntax", () => {
    const script = windowsStubScript("run `a && b` (in C:\\x 100%)");
    expect(script).toContain(">&2 echo penguin: ");
    expect(script).toContain("^&^&");
    expect(script).toContain("^(in C:\\x 100%%^)");
    expect(script).toContain("exit /b 1");
  });
});

describe("ensureCliShim", () => {
  it("writes an executable shim into <root>/bin and reports what it wrote", async () => {
    const root = await tempRoot();
    const result = ensureCliShim(root, "/repo/packages/cli/dist/penguin.js", LINUX);
    expect(result).toEqual({
      kind: "written",
      dir: cliShimDir(root),
      entry: "/repo/packages/cli/dist/penguin.js",
      execArgs: [],
    });
    const shim = path.join(root, "bin", "penguin");
    expect(fs.readFileSync(shim, "utf8")).toContain("/repo/packages/cli/dist/penguin.js");
    // The whole point is that a shell can run it.
    if (POSIX) expect(fs.statSync(shim).mode & 0o111).toBe(0o111);
  });

  it("rewrites a shim left by an earlier boot, executable bit included", async () => {
    const root = await tempRoot();
    ensureCliShim(root, "/old/penguin.js", LINUX);
    const shim = path.join(root, "bin", "penguin");
    // A checkout that moved, and a mode someone else narrowed: writeFileSync applies its
    // `mode` only when it creates the file, so the rewrite has to chmod as well.
    if (POSIX) fs.chmodSync(shim, 0o600);
    ensureCliShim(root, "/new/penguin.js", LINUX);
    expect(fs.readFileSync(shim, "utf8")).toContain("/new/penguin.js");
    expect(fs.readFileSync(shim, "utf8")).not.toContain("/old/penguin.js");
    if (POSIX) expect(fs.statSync(shim).mode & 0o111).toBe(0o111);
  });

  it("writes the .cmd half only on Windows, and removes both when there is no entry", async () => {
    const root = await tempRoot();
    const posix = path.join(root, "bin", "penguin");
    const windows = path.join(root, "bin", "penguin.cmd");

    ensureCliShim(root, "/repo/penguin.js", LINUX);
    expect(fs.existsSync(windows)).toBe(false);

    ensureCliShim(root, "C:\\repo\\penguin.js", {
      execPath: "C:\\node.exe",
      electron: false,
      platform: "win32",
    });
    expect(fs.existsSync(windows)).toBe(true);

    // No entry to point at: a launcher aimed at a path that is no longer there is worse
    // than no `penguin` at all — and both spellings go, whichever OS wrote them.
    expect(ensureCliShim(root, null)).toEqual({ kind: "absent" });
    expect(fs.existsSync(posix)).toBe(false);
    expect(fs.existsSync(windows)).toBe(false);
  });

  it("writes a stub in place of the launcher when a checkout's CLI cannot run", async () => {
    const root = await tempRoot();
    ensureCliShim(root, "/repo/penguin.js", LINUX);
    const result = ensureCliShim(root, null, { ...LINUX, unavailable: "not built" });
    expect(result).toEqual({ kind: "stub", dir: cliShimDir(root), reason: "not built" });
    const shim = path.join(root, "bin", "penguin");
    expect(fs.readFileSync(shim, "utf8")).not.toContain("/repo/penguin.js");
    if (POSIX) expect(fs.statSync(shim).mode & 0o111).toBe(0o111);
  });

  it("reports a root it cannot write instead of taking the server down", async () => {
    const root = await tempRoot();
    // A FILE where the bin directory would go: mkdir fails, and so would every write.
    fs.writeFileSync(path.join(root, "bin"), "not a directory");
    expect(ensureCliShim(root, "/repo/penguin.js", LINUX).kind).toBe("failed");
    expect(ensureCliShim(root, null, { ...LINUX, unavailable: "x" }).kind).toBe("failed");
  });

  it("removing a shim that was never written is not an error", async () => {
    const root = await tempRoot();
    expect(ensureCliShim(root, null)).toEqual({ kind: "absent" });
  });
});

describe("resolveCliLaunch: which CLI a server offers", () => {
  const LOADER = "file:///repo/tsx/loader.mjs";

  /** A checkout with the CLI pieces asked for; returns the workspace root. */
  async function checkout(has: { source?: boolean; build?: boolean }): Promise<string> {
    const repo = await tempRoot();
    fs.writeFileSync(path.join(repo, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    const write = (rel: string): void => {
      fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
      fs.writeFileSync(path.join(repo, rel), "\n");
    };
    if (has.source) write("packages/cli/src/penguin.ts");
    if (has.build) write("packages/cli/dist/penguin.js");
    return repo;
  }
  const serverSrc = (repo: string): string => {
    const dir = path.join(repo, "packages", "server", "src");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  const loaderFound = (): string => LOADER;
  const noLoader = (): null => null;

  it("takes PENGUIN_CLI_ENTRY when set, trimmed; a blank one counts as unset", async () => {
    const repo = await checkout({ source: true, build: true });
    const base = {
      moduleDir: serverSrc(repo),
      source: true,
      electron: false,
      tsLoader: loaderFound,
    };
    expect(resolveCliLaunch({ ...base, explicit: " /opt/penguin/dist/penguin.js " })).toEqual({
      entry: "/opt/penguin/dist/penguin.js",
      execArgs: [],
      checkout: repo,
      origin: "env",
      unavailable: null,
    });
    expect(resolveCliLaunch({ ...base, explicit: "  " }).origin).toBe("source");
  });

  it("offers nothing, and reports nothing missing, outside a checkout", async () => {
    const notARepo = await tempRoot();
    expect(
      resolveCliLaunch({
        explicit: undefined,
        moduleDir: notARepo,
        source: false,
        electron: false,
        tsLoader: loaderFound,
      }),
    ).toEqual({ entry: null, execArgs: [], checkout: null, origin: null, unavailable: null });
  });

  it("a server running from source offers the CLI source through the checkout's loader", async () => {
    const repo = await checkout({ source: true, build: true });
    const launch = resolveCliLaunch({
      explicit: undefined,
      moduleDir: serverSrc(repo),
      source: true,
      electron: false,
      tsLoader: loaderFound,
    });
    expect(launch).toEqual({
      entry: path.join(repo, "packages", "cli", "src", "penguin.ts"),
      execArgs: ["--import", LOADER],
      checkout: repo,
      origin: "source",
      unavailable: null,
    });
  });

  it("…and the build when the loader does not resolve", async () => {
    const repo = await checkout({ source: true, build: true });
    const launch = resolveCliLaunch({
      explicit: undefined,
      moduleDir: serverSrc(repo),
      source: true,
      electron: false,
      tsLoader: noLoader,
    });
    expect(launch.origin).toBe("build");
    expect(launch.entry).toBe(path.join(repo, "packages", "cli", "dist", "penguin.js"));
    expect(launch.execArgs).toEqual([]);
  });

  it("a built server offers the build, and the source when nothing is built", async () => {
    const built = await checkout({ source: true, build: true });
    const fromDist = (repo: string): string => {
      const dir = path.join(repo, "packages", "server", "dist");
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    };
    const opts = { explicit: undefined, source: false, electron: false, tsLoader: loaderFound };
    expect(resolveCliLaunch({ ...opts, moduleDir: fromDist(built) }).origin).toBe("build");

    const unbuilt = await checkout({ source: true });
    expect(resolveCliLaunch({ ...opts, moduleDir: fromDist(unbuilt) }).origin).toBe("source");
  });

  it("Electron runs no loader: the build only, else a reason that says what to build", async () => {
    const built = await checkout({ source: true, build: true });
    const desktopDist = (repo: string): string => {
      const dir = path.join(repo, "packages", "desktop", "dist");
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    };
    const opts = { explicit: undefined, source: false, electron: true, tsLoader: loaderFound };
    expect(resolveCliLaunch({ ...opts, moduleDir: desktopDist(built) }).origin).toBe("build");

    const unbuilt = await checkout({ source: true });
    const launch = resolveCliLaunch({ ...opts, moduleDir: desktopDist(unbuilt) });
    expect(launch.entry).toBeNull();
    expect(launch.checkout).toBe(unbuilt);
    expect(launch.unavailable).toContain(path.join("packages", "cli", "dist", "penguin.js"));
    expect(launch.unavailable).toContain("pnpm --filter @prismshadow/penguin-cli build");
  });

  it("a checkout with neither a runnable source nor a build says so", async () => {
    const repo = await checkout({ source: true });
    const launch = resolveCliLaunch({
      explicit: undefined,
      moduleDir: serverSrc(repo),
      source: true,
      electron: false,
      tsLoader: noLoader,
    });
    expect(launch.entry).toBeNull();
    expect(launch.unavailable).toMatch(/not built .*tsx/);
  });

  it("finds the workspace from any depth a server module runs at", async () => {
    const repo = await checkout({});
    // src under tsx, dist when built, the desktop bundle, a copy pnpm injected elsewhere.
    for (const rel of [
      "packages/server/src/services",
      "packages/server/dist",
      "packages/desktop/dist",
      "node_modules/.pnpm/x/node_modules/@prismshadow/penguin-server/dist",
    ]) {
      const from = path.join(repo, rel);
      fs.mkdirSync(from, { recursive: true });
      expect(workspaceRoot(from), rel).toBe(repo);
    }
  });
});

/** This checkout's own CLI, the way a dev server running from source offers it. */
const THIS_CHECKOUT_CLI = resolveCliLaunch({
  explicit: undefined,
  moduleDir: path.dirname(fileURLToPath(import.meta.url)),
  source: true,
  electron: false,
});

describe.skipIf(!POSIX)("a penguin started through the shim", () => {
  /** Runs `file` with `args` in a clean environment (nothing of this process's PENGUIN_*). */
  function run(file: string, args: string[], env: Record<string, string>, cwd: string) {
    const res = spawnSync(file, args, {
      cwd,
      encoding: "utf8",
      timeout: 60_000,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
        PENGUIN_LANG: "en",
        ...env,
      },
    });
    return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  }

  it("targets the server's data root unless the caller set PENGUIN_HOME; empty is unset", async () => {
    const root = await tempRoot();
    const entry = path.join(root, "report.mjs");
    fs.writeFileSync(
      entry,
      "process.stdout.write(JSON.stringify({ home: process.env.PENGUIN_HOME ?? null, " +
        "args: process.argv.slice(2) }));\n",
    );
    ensureCliShim(root, entry, { execPath: process.execPath, electron: false });
    const shim = path.join(cliShimDir(root), "penguin");
    const home = (env: Record<string, string>) =>
      JSON.parse(run(shim, ["a b", "c"], env, root).stdout) as { home: string; args: string[] };

    expect(home({})).toEqual({ home: root, args: ["a b", "c"] });
    expect(home({ PENGUIN_HOME: "/somewhere/else" }).home).toBe("/somewhere/else");
    expect(home({ PENGUIN_HOME: "" }).home).toBe(root);
  });

  it("names the server's database with its root when it is not the root's web.db", async () => {
    const root = await tempRoot();
    const entry = path.join(root, "report.mjs");
    fs.writeFileSync(
      entry,
      "process.stdout.write(JSON.stringify({ home: process.env.PENGUIN_HOME ?? null, " +
        "db: process.env.PENGUIN_WEB_DB ?? null }));\n",
    );
    const shim = path.join(cliShimDir(root), "penguin");
    const seen = (env: Record<string, string>) =>
      JSON.parse(run(shim, [], env, root).stdout) as { home: string; db: string | null };
    const write = (dbPath: string): void => {
      ensureCliShim(root, entry, { execPath: process.execPath, electron: false, dbPath });
    };

    write("/var/lib/penguin/web.db");
    expect(seen({})).toEqual({ home: root, db: "/var/lib/penguin/web.db" });
    // A caller who chose another root chose its database too: nothing of this server's is added.
    expect(seen({ PENGUIN_HOME: "/elsewhere" })).toEqual({ home: "/elsewhere", db: null });

    // A relative PENGUIN_WEB_DB is the file the server opened from its own working directory,
    // whichever directory the CLI is then run in (here the root, not this process's cwd).
    write(path.join("state", "web.db"));
    expect(seen({})).toEqual({ home: root, db: path.resolve("state", "web.db") });

    // The default file, and a database only the server's own process can open, go unnamed.
    for (const dbPath of [path.join(root, "web.db"), ":memory:"]) {
      write(dbPath);
      expect(seen({}), dbPath).toEqual({ home: root, db: null });
    }
  });

  it("the stub prints why to stderr and fails, running nothing else", async () => {
    const root = await tempRoot();
    ensureCliShim(root, null, { unavailable: "packages/cli/dist/penguin.js is not built" });
    const res = run(path.join(cliShimDir(root), "penguin"), ["--version"], {}, root);
    expect(res.status).toBe(1);
    expect(res.stdout).toBe("");
    expect(res.stderr).toContain(
      "cannot run its own CLI: packages/cli/dist/penguin.js is not built",
    );
    // The text is literal: nothing in it was expanded by the shell.
    expect(posixStubScript("$HOME `id`")).toContain("$HOME `id`");
  });

  it("the real CLI's data root: --root, then an explicit PENGUIN_HOME, then the shim's, then ~/.penguin/data", async () => {
    const root = await tempRoot();
    const home = await tempRoot();
    ensureCliShim(root, THIS_CHECKOUT_CLI.entry, {
      execPath: process.execPath,
      electron: false,
      execArgs: THIS_CHECKOUT_CLI.execArgs,
    });
    const shim = path.join(cliShimDir(root), "penguin");
    // `auth status` names the session file it looked for, which sits in the data root.
    const rootOf = (file: string, args: string[], env: Record<string, string>): string => {
      const res = run(file, ["auth", "status", ...args], { HOME: home, ...env }, home);
      expect(res.status, res.stderr).toBe(0);
      return path.dirname(/\(no (.+)\)\./.exec(res.stdout)?.[1] ?? "");
    };
    const elsewhere = path.join(home, "elsewhere");
    const flagged = path.join(home, "flagged");

    expect(rootOf(shim, [], {})).toBe(root);
    expect(rootOf(shim, [], { PENGUIN_HOME: elsewhere })).toBe(elsewhere);
    expect(rootOf(shim, ["--root", flagged], { PENGUIN_HOME: elsewhere })).toBe(flagged);
    // Without the shim the CLI is what it always was: the default root under HOME.
    const direct = [...THIS_CHECKOUT_CLI.execArgs, THIS_CHECKOUT_CLI.entry!];
    const res = run(process.execPath, [...direct, "auth", "status"], { HOME: home }, home);
    expect(res.stdout).toContain(path.join(home, ".penguin", "data", "cli-session.json"));
  }, 60_000);
});

describe("this checkout, as a dev server running from source sees it", () => {
  it("offers its own CLI source, through the tsx its CLI package depends on", () => {
    // A test runs from source exactly as `pnpm dev` runs the server: what it finds is what a
    // dev server here offers — this checkout's CLI as it is now, never a build from earlier.
    const checkout = workspaceRoot(path.dirname(fileURLToPath(import.meta.url)));
    expect(THIS_CHECKOUT_CLI).toEqual({
      entry: path.join(checkout!, "packages", "cli", "src", "penguin.ts"),
      execArgs: ["--import", expect.stringMatching(/^file:\/\/.*\/tsx\//)],
      checkout,
      origin: "source",
      unavailable: null,
    });
  });
});
