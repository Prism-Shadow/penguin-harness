/**
 * The installer that runs ON the target (shipped as a file beside the module that sends it),
 * executed for real against a temporary HOME. It is plain Node with no dependencies precisely so it can run
 * anywhere — including here — so these tests drive the actual script rather than a model of
 * it: fresh install, upgrade over an existing one, rollback when the staged tree does not run,
 * and the data directory surviving all of it.
 *
 * POSIX-only: the fake runtime is a shell script standing in for node. The Windows branches it
 * exercises (launcher text, program directory) are covered by reading the produced files.
 */
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packDirectory } from "../src/machines/pack.js";

const posixOnly = process.platform === "win32" ? describe.skip : describe;

/** The real script under test — the file the push copies out. */
const INSTALLER_SOURCE = path.resolve(__dirname, "..", "src", "machines", "remote-installer.cjs");
/** Required by the installer on the far side, so it rides scp beside it. */
const LAUNCHER_SOURCE = path.resolve(__dirname, "..", "src", "machines", "launcher.cjs");

let INSTALLER: string;
const RUNTIME_DIR_NAME = "node-v24.18.0-linux-x64";

posixOnly("remote-installer.cjs", () => {
  let work: string;
  let home: string;
  let scratch: string;

  /** A scratch directory shaped exactly like the one the push leaves on the remote. */
  const prepareScratch = (opts: {
    cliBody: string;
    withRuntime?: boolean;
    /** What the push probed on that machine; drives the --experimental-sqlite decision. */
    nodeVersion?: string;
  }) => {
    // The image: penguin/{lib,web}. Only lib/dist/penguin.js has to be real — the installer
    // smoke-tests it and copies everything else verbatim.
    const image = path.join(work, "image");
    fs.mkdirSync(path.join(image, "penguin", "lib", "dist"), { recursive: true });
    fs.mkdirSync(path.join(image, "penguin", "web"), { recursive: true });
    fs.writeFileSync(path.join(image, "penguin", "lib", "dist", "penguin.js"), opts.cliBody);
    fs.writeFileSync(path.join(image, "penguin", "web", "index.html"), "<html>");
    fs.writeFileSync(
      path.join(image, "penguin", "lib", "package.json"),
      JSON.stringify({ name: "@prismshadow/penguin-cli", version: "9.9.9" }),
    );

    fs.mkdirSync(scratch, { recursive: true });
    fs.writeFileSync(path.join(scratch, "penguin-image.pack"), packDirectory(image));
    const withRuntime = opts.withRuntime ?? true;
    fs.writeFileSync(
      path.join(scratch, "job.json"),
      JSON.stringify({
        packName: "penguin-image.pack",
        // null = the machine had a usable node of its own, so none was sent.
        runtimeDirName: withRuntime ? RUNTIME_DIR_NAME : null,
        nodeVersion: withRuntime ? null : (opts.nodeVersion ?? process.version),
      }),
    );
    // The "runtime" the bootstrap would have unpacked: a node stand-in that forwards to the
    // real one, so the installer's smoke test runs the staged CLI for real.
    const runtimeBin = path.join(scratch, RUNTIME_DIR_NAME, "bin");
    fs.mkdirSync(runtimeBin, { recursive: true });
    fs.writeFileSync(path.join(runtimeBin, "node"), `#!/bin/sh\nexec ${process.execPath} "$@"\n`, {
      mode: 0o755,
    });
    // The push copies both scripts INTO the scratch directory, and the installer reads
    // job.json from its own directory — so the test has to place them the same way.
    fs.copyFileSync(INSTALLER, path.join(scratch, "remote-installer.cjs"));
    fs.copyFileSync(LAUNCHER_SOURCE, path.join(scratch, "launcher.cjs"));
  };

  const runInstaller = () =>
    cp.spawnSync(process.execPath, [path.join(scratch, "remote-installer.cjs")], {
      cwd: scratch,
      encoding: "utf8",
      env: { ...process.env, HOME: home, XDG_DATA_HOME: path.join(home, ".local", "share") },
    });

  const programDir = () => path.join(home, ".local", "share", "penguin");

  beforeEach(() => {
    // realpathSync: on macOS os.tmpdir() is /var/… which is a symlink to /private/var/…, and
    // the installer's own realpath of the launcher symlink resolves it — comparing the two
    // spellings of the same directory fails there and nowhere else.
    work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penguin-installer-test-")));
    home = path.join(work, "home");
    scratch = path.join(work, "scratch");
    fs.mkdirSync(home, { recursive: true });
    INSTALLER = path.join(work, "remote-installer.cjs");
    fs.copyFileSync(INSTALLER_SOURCE, INSTALLER);
  });
  afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it("installs into the XDG program directory, runtime and launchers included", () => {
    prepareScratch({ cliBody: "console.log('9.9.9');\n" });
    const result = runInstaller();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`installed to ${programDir()}`);

    // The image, plus the runtime moved in as node/ so the install carries its own Node.
    expect(fs.existsSync(path.join(programDir(), "lib", "dist", "penguin.js"))).toBe(true);
    expect(fs.existsSync(path.join(programDir(), "web", "index.html"))).toBe(true);
    expect(fs.existsSync(path.join(programDir(), "node", "bin", "node"))).toBe(true);

    // Both launchers are written, and the POSIX one is executable and finds that runtime.
    const launcher = fs.readFileSync(path.join(programDir(), "bin", "penguin"), "utf8");
    expect(launcher).toContain('"$DIR/node/bin/node"');
    expect(launcher).toContain('PENGUIN_WEB_DIST="${PENGUIN_WEB_DIST:-$DIR/web}"');
    expect(fs.statSync(path.join(programDir(), "bin", "penguin")).mode & 0o111).not.toBe(0);
    const cmd = fs.readFileSync(path.join(programDir(), "bin", "penguin.cmd"), "utf8");
    expect(cmd).toContain("%DIR%\\node\\node.exe");

    // …and the convenience symlink an ordinary install also leaves.
    expect(fs.realpathSync(path.join(home, ".local", "bin", "penguin"))).toBe(
      path.join(programDir(), "bin", "penguin"),
    );
    // Nothing is left behind next to the program directory.
    const siblings = fs.readdirSync(path.dirname(programDir()));
    expect(siblings.filter((name) => name.startsWith("penguin."))).toEqual([]);
  });

  it("installs without a runtime when the machine's own node is used", () => {
    prepareScratch({ cliBody: "console.log('9.9.9');\n", withRuntime: false });
    const result = runInstaller();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("using this machine's Node");
    // No runtime inside the install, and the launcher's fallback path is what will run it.
    expect(fs.existsSync(path.join(programDir(), "node"))).toBe(false);
    expect(fs.readFileSync(path.join(programDir(), "bin", "penguin"), "utf8")).toContain(
      'exec node "$DIR/lib/dist/penguin.js"',
    );
  });

  it("flags an older Node into the launcher, since node:sqlite is gated there", () => {
    // 22 and 23 have node:sqlite only behind --experimental-sqlite. The decision is made
    // once, at install time, from the version the push probed.
    prepareScratch({
      cliBody: "console.log('9.9.9');\n",
      withRuntime: false,
      nodeVersion: "v22.11.0",
    });
    const result = runInstaller();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("with --experimental-sqlite");
    expect(fs.readFileSync(path.join(programDir(), "bin", "penguin"), "utf8")).toContain(
      'exec node --experimental-sqlite "$DIR/lib/dist/penguin.js"',
    );
    expect(fs.readFileSync(path.join(programDir(), "bin", "penguin.cmd"), "utf8")).toContain(
      'node --experimental-sqlite "%DIR%\\lib\\dist\\penguin.js"',
    );
  });

  it("does not flag a current Node, and never flags the bundled runtime", () => {
    prepareScratch({
      cliBody: "console.log('9.9.9');\n",
      withRuntime: false,
      nodeVersion: "v24.3.0",
    });
    expect(runInstaller().status).toBe(0);
    expect(fs.readFileSync(path.join(programDir(), "bin", "penguin"), "utf8")).toContain(
      'exec node "$DIR/lib/dist/penguin.js"',
    );
  });

  it("refuses a machine whose Node cannot provide node:sqlite", () => {
    prepareScratch({ cliBody: "console.log('9.9.9');\n", withRuntime: true });
    // A runtime that runs, but whose node has no node:sqlite — the shape of an old or
    // stripped build. The check must catch it here, not at first server start.
    const fakeNode = path.join(scratch, RUNTIME_DIR_NAME, "bin", "node");
    fs.writeFileSync(
      fakeNode,
      [
        "#!/bin/sh",
        // The capability probe is the only call with -e; fail it, pass everything else.
        'case "$*" in *getBuiltinModule*) exit 9 ;; esac',
        `exec ${process.execPath} "$@"`,
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    const result = runInstaller();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cannot provide node:sqlite");
    expect(fs.existsSync(programDir())).toBe(false);
  });

  it("upgrades over an existing install and leaves the data directory alone", () => {
    // A previous install, and a data directory that must survive it.
    fs.mkdirSync(path.join(programDir(), "lib"), { recursive: true });
    fs.writeFileSync(path.join(programDir(), "lib", "old-marker"), "old");
    const dataFile = path.join(home, ".penguin", "data", "web.db");
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(dataFile, "sessions");

    prepareScratch({ cliBody: "console.log('9.9.9');\n" });
    expect(runInstaller().status).toBe(0);

    expect(fs.existsSync(path.join(programDir(), "lib", "old-marker"))).toBe(false);
    expect(fs.existsSync(path.join(programDir(), "lib", "dist", "penguin.js"))).toBe(true);
    expect(fs.readFileSync(dataFile, "utf8")).toBe("sessions");
  });

  it("leaves the existing install untouched when the staged one does not run", () => {
    fs.mkdirSync(path.join(programDir(), "lib"), { recursive: true });
    fs.writeFileSync(path.join(programDir(), "lib", "old-marker"), "old");

    // A CLI that fails its smoke test, the way a broken or half-copied image would.
    prepareScratch({ cliBody: "process.exit(3);\n" });
    const result = runInstaller();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("does not run");
    // The smoke test runs BEFORE the swap, so the working install was never disturbed and
    // there is nothing to restore — the restore branch is the safety net for a failure
    // between the two renames.
    expect(fs.readFileSync(path.join(programDir(), "lib", "old-marker"), "utf8")).toBe("old");
    expect(result.stdout).not.toContain("previous installation was restored");
    // No staging or backup husks left in the way of the next attempt.
    const siblings = fs.readdirSync(path.dirname(programDir()));
    expect(siblings.filter((name) => name.startsWith("penguin."))).toEqual([]);
  });
});

describe("shipping the installer", () => {
  /**
   * The push copies these files out; they are never imported, so nothing in the module graph
   * would notice one going missing from a built package. `files: ["dist"]` is what npm ships
   * and tsup only emits entries, which is why the build copies them in — and why that copy is
   * worth an assertion rather than a comment. Missing launcher.cjs would break every install
   * at the far side's `require`, long after the bytes were sent.
   */
  it.each([
    ["remote-installer.cjs", INSTALLER_SOURCE],
    ["launcher.cjs", LAUNCHER_SOURCE],
  ])("copies %s into dist at build time", (name, source) => {
    const built = path.resolve(__dirname, "..", "dist", name);
    if (!fs.existsSync(built)) return; // Not built in this run; `pnpm build` covers it in CI.
    expect(fs.readFileSync(built, "utf8")).toBe(fs.readFileSync(source, "utf8"));
  });
});
