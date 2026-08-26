/**
 * The payload launchers, and with them the layout every non-Electron install has. One
 * generator now serves the release packages, the install image and a pushed install; these
 * assertions are the layout contract those three agree on.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { posixLauncher, windowsLauncher } = require(
  path.resolve(__dirname, "..", "src", "machines", "launcher.cjs"),
) as {
  posixLauncher: (nodeFlags?: string[]) => string;
  windowsLauncher: (nodeFlags?: string[]) => string;
};

describe("posixLauncher", () => {
  const script = posixLauncher();

  it("resolves through the ~/.local/bin symlink the installers leave", () => {
    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
    expect(script).toContain('while [ -h "$SOURCE" ]');
  });

  it("finds web/ and node/ at the top of the tree, and the CLI inside lib/", () => {
    expect(script).toContain('export PENGUIN_WEB_DIST="${PENGUIN_WEB_DIST:-$DIR/web}"');
    expect(script).toContain('if [ -x "$DIR/node/bin/node" ]; then');
    expect(script).toContain('exec "$DIR/node/bin/node" "$DIR/lib/dist/penguin.js" "$@"');
    expect(script).toContain('exec node "$DIR/lib/dist/penguin.js" "$@"');
  });

  it("runs on plain Node: the far side has no Electron", () => {
    expect(script).not.toContain("ELECTRON_RUN_AS_NODE");
    expect(windowsLauncher()).not.toContain("ELECTRON_RUN_AS_NODE");
  });

  it("puts the flags on the system-node branch only", () => {
    const flagged = posixLauncher(["--experimental-sqlite"]);
    expect(flagged).toContain('exec node --experimental-sqlite "$DIR/lib/dist/penguin.js" "$@"');
    // A bundled runtime is the pinned build; flagging it would be noise at best.
    expect(flagged).toContain('exec "$DIR/node/bin/node" "$DIR/lib/dist/penguin.js" "$@"');
  });
});

describe("windowsLauncher", () => {
  const cmd = windowsLauncher();

  it("is CRLF throughout, which is the only form cmd.exe is reliable with", () => {
    expect(cmd.startsWith("@echo off\r\n")).toBe(true);
    expect(cmd.split("\n").every((line) => line === "" || line.endsWith("\r"))).toBe(true);
  });

  it("mirrors the POSIX layout in backslashes", () => {
    expect(cmd).toContain('set "PENGUIN_WEB_DIST=%DIR%\\web"');
    expect(cmd).toContain('if exist "%DIR%\\node\\node.exe" (');
    expect(cmd).toContain('"%DIR%\\node\\node.exe" "%DIR%\\lib\\dist\\penguin.js" %*');
    expect(cmd).toContain('node "%DIR%\\lib\\dist\\penguin.js" %*');
  });

  it("advertises MinGit when the tree carries it, and shrugs when it does not", () => {
    expect(cmd).toContain('if exist "%DIR%\\git\\usr\\bin\\sh.exe"');
  });

  it("takes the flags on the system-node branch too", () => {
    expect(windowsLauncher(["--experimental-sqlite"])).toContain(
      'node --experimental-sqlite "%DIR%\\lib\\dist\\penguin.js" %*',
    );
  });

  it("names the entry the CLI actually builds", () => {
    expect(cmd).not.toContain("dist\\index.js");
    expect(posixLauncher()).not.toContain("dist/index.js");
  });
});
