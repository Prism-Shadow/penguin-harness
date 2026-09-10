/**
 * The `<root>/bin/penguin` shim a boot writes so an Agent's commands reach this harness's
 * own CLI: what goes into the launcher scripts, when they are removed again, and how the
 * checkout fallback finds an entry to point at.
 */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  checkoutCliEntry,
  cliShimDir,
  ensureCliShim,
  posixShimScript,
  windowsShimScript,
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

describe("the launcher scripts", () => {
  it("exec the server's own interpreter on the entry, forwarding every argument", () => {
    const script = posixShimScript("/usr/bin/node", "/repo/packages/cli/dist/penguin.js", false);
    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
    expect(script).toContain(`exec '/usr/bin/node' '/repo/packages/cli/dist/penguin.js' "$@"`);
    expect(script).not.toContain("ELECTRON_RUN_AS_NODE");
  });

  it("set ELECTRON_RUN_AS_NODE when the interpreter is an Electron binary", () => {
    // Under the desktop app the server IS Electron: without the flag the shim would boot a
    // second copy of the app instead of running the CLI.
    const script = posixShimScript("/Applications/P.app/Contents/MacOS/P", "/app/penguin.js", true);
    expect(script).toContain("export ELECTRON_RUN_AS_NODE=1");
    expect(script.indexOf("ELECTRON_RUN_AS_NODE")).toBeLessThan(script.indexOf("exec "));
  });

  it("quote a path that carries a shell metacharacter", () => {
    const script = posixShimScript("/usr/bin/node", "/home/anne's data/penguin.js", false);
    expect(script).toContain(`'/home/anne'\\''s data/penguin.js'`);
  });

  it("the Windows half is CRLF and forwards %* with the errorlevel", () => {
    const script = windowsShimScript("C:\\node.exe", "C:\\app\\penguin.js", false);
    expect(script.startsWith("@echo off\r\n")).toBe(true);
    expect(script).toContain(`"C:\\node.exe" "C:\\app\\penguin.js" %*`);
    expect(script).toContain("exit /b %errorlevel%");
    expect(script.includes("\n\r")).toBe(false);
  });
});

/**
 * POSIX permission bits are a POSIX fact: on win32 `chmod` only toggles the read-only
 * attribute and `stat().mode` never reports an execute bit, so an `x`-bit assertion there
 * says nothing about either the code or the platform. What the shim CONTAINS is asserted
 * everywhere; whether it is marked executable is asserted where the mark exists.
 */
const POSIX_MODES = process.platform !== "win32";

describe("ensureCliShim", () => {
  it("writes an executable shim into <root>/bin and reports what it wrote", async () => {
    const root = await tempRoot();
    const result = ensureCliShim(root, "/repo/packages/cli/dist/penguin.js", {
      execPath: "/usr/bin/node",
      electron: false,
      platform: "linux",
    });
    expect(result).toEqual({
      kind: "written",
      dir: cliShimDir(root),
      entry: "/repo/packages/cli/dist/penguin.js",
    });
    const shim = path.join(root, "bin", "penguin");
    expect(fs.readFileSync(shim, "utf8")).toContain("/repo/packages/cli/dist/penguin.js");
    // The whole point is that a shell can run it.
    if (POSIX_MODES) expect(fs.statSync(shim).mode & 0o111).toBe(0o111);
  });

  it("rewrites a shim left by an earlier boot, executable bit included", async () => {
    const root = await tempRoot();
    const opts = { execPath: "/usr/bin/node", electron: false, platform: "linux" } as const;
    ensureCliShim(root, "/old/penguin.js", opts);
    const shim = path.join(root, "bin", "penguin");
    // A checkout that moved, and a mode someone else narrowed: writeFileSync applies its
    // `mode` only when it creates the file, so the rewrite has to chmod as well.
    if (POSIX_MODES) fs.chmodSync(shim, 0o600);
    ensureCliShim(root, "/new/penguin.js", opts);
    expect(fs.readFileSync(shim, "utf8")).toContain("/new/penguin.js");
    expect(fs.readFileSync(shim, "utf8")).not.toContain("/old/penguin.js");
    if (POSIX_MODES) expect(fs.statSync(shim).mode & 0o111).toBe(0o111);
  });

  it("writes the .cmd half only on Windows, and removes both when there is no entry", async () => {
    const root = await tempRoot();
    const posix = path.join(root, "bin", "penguin");
    const windows = path.join(root, "bin", "penguin.cmd");

    ensureCliShim(root, "/repo/penguin.js", {
      execPath: "/usr/bin/node",
      electron: false,
      platform: "linux",
    });
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

  it("reports a root it cannot write instead of taking the server down", async () => {
    const root = await tempRoot();
    // A FILE where the bin directory would go: mkdir fails, and so would every write.
    fs.writeFileSync(path.join(root, "bin"), "not a directory");
    const result = ensureCliShim(root, "/repo/penguin.js", {
      execPath: "/usr/bin/node",
      electron: false,
      platform: "linux",
    });
    expect(result.kind).toBe("failed");
  });

  it("removing a shim that was never written is not an error", async () => {
    const root = await tempRoot();
    expect(ensureCliShim(root, null)).toEqual({ kind: "absent" });
  });
});

describe("checkoutCliEntry", () => {
  it("walks up to the workspace root and names its built CLI entry", async () => {
    const repo = await tempRoot();
    fs.writeFileSync(path.join(repo, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    const entry = path.join(repo, "packages", "cli", "dist", "penguin.js");
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, "#!/usr/bin/env node\n");

    // The depth differs per run shape — src under tsx, dist when built, a bundle under the
    // desktop shell — which is why the walk looks for the workspace file rather than
    // counting `..` segments.
    for (const from of [
      path.join(repo, "packages", "server", "src", "services"),
      path.join(repo, "packages", "server", "dist"),
      path.join(repo, "packages", "desktop", "dist"),
    ]) {
      fs.mkdirSync(from, { recursive: true });
      expect(checkoutCliEntry(from), from).toBe(entry);
    }
  });

  it("answers null for a workspace whose CLI has not been built", async () => {
    const repo = await tempRoot();
    fs.writeFileSync(path.join(repo, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    expect(checkoutCliEntry(repo)).toBeNull();
  });

  it("answers null outside a checkout, having walked to the filesystem root", async () => {
    const notARepo = await tempRoot();
    expect(checkoutCliEntry(notARepo)).toBeNull();
  });
});
