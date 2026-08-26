/**
 * The far side of a push, run for real: the payload install-server.ts would assemble, fed to
 * the ACTUAL install.sh in its sibling-offline mode against a temporary HOME. This is the
 * whole point of pushing the ordinary installer — the staging, smoke test, swap, rollback and
 * symlink behavior under test here is the same code every release install runs, so these
 * tests only cover what the PUSH adds: the payload's shape, the launchers baked for the
 * remote, and the checksum handshake.
 *
 * POSIX-only: install.ps1 would need a Windows host. The Windows payload's shape is covered
 * by the zip assertions in machines-archive.test.ts and machines.test.ts.
 */
import cp from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tarGzBytes } from "../src/machines/archive.js";
import type { PackFile } from "../src/machines/archive.js";
import { sha256Of } from "../src/machines/runtime.js";

const posixOnly = process.platform === "win32" ? describe.skip : describe;

const require = createRequire(import.meta.url);
const { posixLauncher, windowsLauncher } = require(
  path.resolve(__dirname, "..", "src", "machines", "launcher.cjs"),
) as {
  posixLauncher: (nodeFlags?: string[]) => string;
  windowsLauncher: (nodeFlags?: string[]) => string;
};

/** The installer the push copies out — the repo's own release install.sh. */
const INSTALL_SH = path.resolve(__dirname, "..", "..", "..", "install.sh");

posixOnly("pushing through install.sh", () => {
  let work: string;
  let home: string;
  let scratch: string;

  /** The target string install.sh's own uname check on THIS machine will accept. */
  const hostTarget = `${process.platform}-${process.arch}`;

  /** Assembles the payload the way installOnRemote does, parameterized like a push. */
  const writePayload = (opts: { cliBody: string; withRuntime?: boolean; nodeFlags?: string[] }) => {
    const files: PackFile[] = [
      { path: "penguin/lib/dist/penguin.js", data: Buffer.from(opts.cliBody) },
      {
        path: "penguin/lib/package.json",
        data: Buffer.from(JSON.stringify({ name: "@prismshadow/penguin-cli", version: "9.9.9" })),
      },
      { path: "penguin/web/index.html", data: Buffer.from("<html>") },
      {
        path: "penguin/bin/penguin",
        data: Buffer.from(posixLauncher(opts.nodeFlags ?? [])),
        mode: 0o755,
      },
      { path: "penguin/bin/penguin.cmd", data: Buffer.from(windowsLauncher(opts.nodeFlags ?? [])) },
      {
        path: "penguin/package-manifest.json",
        data: Buffer.from(JSON.stringify({ schemaVersion: 1, target: hostTarget }) + "\n"),
      },
      // The baked runtime: a node stand-in that forwards to the real one, so the installer's
      // smoke test runs the staged CLI for real on the "bundled" runtime path.
      ...(opts.withRuntime !== false
        ? [
            {
              path: "penguin/node/bin/node",
              data: Buffer.from(`#!/bin/sh\nexec ${process.execPath} "$@"\n`),
              mode: 0o755,
            },
          ]
        : []),
    ];
    const payload = tarGzBytes(files);
    fs.writeFileSync(path.join(scratch, "payload.tar.gz"), payload);
    fs.writeFileSync(
      path.join(scratch, "payload.tar.gz.sha256"),
      `${sha256Of(payload)}  payload.tar.gz\n`,
    );
    fs.copyFileSync(INSTALL_SH, path.join(scratch, "install.sh"));
  };

  /** `sh <scratch>/install.sh` — exactly the command the push runs over ssh. */
  const runInstaller = () =>
    cp.spawnSync("sh", [path.join(scratch, "install.sh")], {
      cwd: scratch,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        XDG_DATA_HOME: path.join(home, ".local", "share"),
        PENGUIN_INSTALL_DIR: "",
        PENGUIN_VERSION: "",
        PENGUIN_ARCHIVE: "",
      },
    });

  const programDir = () => path.join(home, ".local", "share", "penguin");

  beforeEach(() => {
    // realpathSync: on macOS os.tmpdir() is /var/… which is a symlink to /private/var/…, and
    // resolved and unresolved spellings of the same tree must not be compared to each other.
    work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penguin-installer-test-")));
    home = path.join(work, "home");
    scratch = path.join(work, "scratch");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(scratch, { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it("installs the payload: program tree, baked runtime, launchers, symlink", () => {
    writePayload({ cliBody: "console.log('9.9.9');\n" });
    const result = runInstaller();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Payload checksum OK.");
    expect(result.stdout).toContain(`installed to ${programDir()}`);

    expect(fs.existsSync(path.join(programDir(), "lib", "dist", "penguin.js"))).toBe(true);
    expect(fs.existsSync(path.join(programDir(), "web", "index.html"))).toBe(true);
    expect(fs.existsSync(path.join(programDir(), "node", "bin", "node"))).toBe(true);
    expect(fs.statSync(path.join(programDir(), "bin", "penguin")).mode & 0o111).not.toBe(0);
    // …and the convenience symlink an ordinary install also leaves.
    expect(fs.realpathSync(path.join(home, ".local", "bin", "penguin"))).toBe(
      path.join(programDir(), "bin", "penguin"),
    );
  });

  it("installs without a runtime, on the launcher's system-node branch", () => {
    writePayload({ cliBody: "console.log('9.9.9');\n", withRuntime: false });
    const result = runInstaller();
    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(programDir(), "node"))).toBe(false);
    expect(fs.readFileSync(path.join(programDir(), "bin", "penguin"), "utf8")).toContain(
      'exec node "$DIR/lib/dist/penguin.js"',
    );
  });

  it("a broken build never replaces a working one, and data survives", () => {
    writePayload({ cliBody: "console.log('9.9.9');\n" });
    expect(runInstaller().status).toBe(0);
    const dataFile = path.join(home, ".penguin", "data", "web.db");
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(dataFile, "precious");

    writePayload({ cliBody: "process.exit(3);\n" });
    const result = runInstaller();
    expect(result.status).not.toBe(0);
    // The previous install is back in place, still running the old build.
    const version = cp.spawnSync(path.join(programDir(), "bin", "penguin"), ["--version"], {
      encoding: "utf8",
    });
    expect(version.stdout.trim()).toBe("9.9.9");
    expect(fs.readFileSync(dataFile, "utf8")).toBe("precious");
  });

  it("refuses a payload whose checksum does not match", () => {
    writePayload({ cliBody: "console.log('9.9.9');\n" });
    fs.appendFileSync(path.join(scratch, "payload.tar.gz"), "tampered");
    const result = runInstaller();
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("checksum mismatch");
    expect(fs.existsSync(programDir())).toBe(false);
  });
});

describe("shipping the installers", () => {
  /**
   * The push copies these files out of dist/; they are never imported, so nothing in the
   * module graph would notice one going missing from a built package. The build copies them
   * in (copy-machine-assets.mjs), and that copy is worth an assertion rather than a comment.
   */
  it.each(["install.sh", "install.ps1"])("copies %s into dist at build time", (name) => {
    const built = path.resolve(__dirname, "..", "dist", name);
    if (!fs.existsSync(built)) return; // Not built in this run; `pnpm build` covers it in CI.
    const source = path.resolve(__dirname, "..", "..", "..", name);
    expect(fs.readFileSync(built, "utf8")).toBe(fs.readFileSync(source, "utf8"));
  });
});
