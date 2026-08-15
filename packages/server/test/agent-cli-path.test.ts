/**
 * agent-cli-path: pure candidate/PATH-merge logic, plus a boot-time proof that the
 * packaged platform's create() actually calls ensureCliOnPath() and extends the real
 * process.env — see packages/server/src/platform/agent-cli-path.ts's own doc comment for
 * why this needs to live in the platform, not the Electron shell.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureCliOnPath, findCliBinDir, prependToPath } from "../src/platform/agent-cli-path.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";

describe("findCliBinDir", () => {
  it("returns null (no-op) when no candidate's launcher file exists", () => {
    const result = findCliBinDir({
      fileExists: () => false,
      platform: "linux",
      execPath: "/opt/PenguinHarness/penguin-harness",
      argv1:
        "/opt/PenguinHarness/resources/app/node_modules/@prismshadow/penguin-server/dist/index.js",
      bundledShell: undefined,
      modulePath:
        "/opt/PenguinHarness/resources/app/node_modules/@prismshadow/penguin-server/dist/platform/agent-cli-path.js",
    });
    expect(result).toBeNull();
  });

  it("does not mutate the deps object it is given", () => {
    const deps = {
      fileExists: () => false,
      platform: "linux" as NodeJS.Platform,
      execPath: "/opt/app/penguin-harness",
      argv1: "/opt/app/resources/app/node_modules/@prismshadow/penguin-server/dist/index.js",
      bundledShell: undefined,
      modulePath:
        "/opt/app/resources/app/node_modules/@prismshadow/penguin-server/dist/platform/agent-cli-path.js",
    };
    const snapshot = { ...deps };
    findCliBinDir(deps);
    expect(deps).toEqual(snapshot);
  });

  // These simulate platform: "linux" explicitly with path.posix (not the ambient
  // `node:path`, which follows whatever OS actually runs the test — this repo's suite
  // runs on Windows CI too, see vitest.config.ts).
  it("prefers process.argv[1] (hot-reload-safe) over this module's own file location", () => {
    const argv1AppDir = "/from-argv1";
    const moduleAppDir = "/from-module-url";
    const existing = new Set([
      path.posix.join(argv1AppDir, "bin", "penguin"),
      path.posix.join(moduleAppDir, "bin", "penguin"),
    ]);
    const result = findCliBinDir({
      fileExists: (p) => existing.has(p),
      platform: "linux",
      execPath: "/unrelated/exe",
      argv1: path.posix.join(
        argv1AppDir,
        "node_modules",
        "@prismshadow",
        "penguin-server",
        "dist",
        "index.js",
      ),
      bundledShell: undefined,
      modulePath: path.posix.join(
        moduleAppDir,
        "node_modules",
        "@prismshadow",
        "penguin-server",
        "dist",
        "platform",
        "agent-cli-path.js",
      ),
    });
    expect(result).toBe(path.posix.join(argv1AppDir, "bin"));
  });

  it("falls back to this module's own file location when argv[1] doesn't match the packaged shape", () => {
    const moduleAppDir = "/from-module-url";
    const binDir = path.posix.join(moduleAppDir, "bin");
    const result = findCliBinDir({
      fileExists: (p) => p === path.posix.join(binDir, "penguin"),
      platform: "linux",
      execPath: "/unrelated/exe",
      argv1: "/some/dev/checkout/dist/index.js", // no node_modules/@prismshadow/penguin-server in sight
      bundledShell: undefined,
      modulePath: path.posix.join(
        moduleAppDir,
        "node_modules",
        "@prismshadow",
        "penguin-server",
        "dist",
        "platform",
        "agent-cli-path.js",
      ),
    });
    expect(result).toBe(binDir);
  });

  it("falls back to the PENGUIN_BUNDLED_SHELL neighborhood on win32 when nothing else matches", () => {
    const resourcesPath = "C:\\Program Files\\PenguinHarness\\resources";
    const binDir = path.win32.join(resourcesPath, "app", "bin");
    const result = findCliBinDir({
      fileExists: (p) => p === path.win32.join(binDir, "penguin.cmd"),
      platform: "win32",
      execPath: "C:\\unrelated\\exe.exe",
      argv1: "C:\\some\\dev\\checkout\\dist\\index.js",
      bundledShell: path.win32.join(resourcesPath, "git", "usr", "bin", "sh.exe"),
      modulePath: "C:\\some\\dev\\checkout\\dist\\platform\\agent-cli-path.js",
    });
    // Windows-shaped candidates are parsed with path.win32 explicitly (not the ambient
    // `node:path`), so this is exact even when the test itself runs on POSIX CI.
    expect(result).toBe(binDir);
  });

  it("is not fooled by PENGUIN_BUNDLED_SHELL on non-Windows platforms", () => {
    // If the win32-only gate on the bundled-shell candidate were missing, this exact
    // sh.exe path would resolve to "/resources/app/bin" (see the win32 test above) and
    // — since fileExists() is unconditionally true here — would be returned instead of
    // falling through to the execPath candidate. Asserting the execPath-derived result
    // (a different path) catches that regression.
    const result = findCliBinDir({
      fileExists: () => true, // even if a file "exists" everywhere
      platform: "linux",
      execPath: "/unrelated/exe",
      argv1: "/some/dev/checkout/dist/index.js",
      bundledShell: "/resources/git/usr/bin/sh.exe",
      modulePath: "/some/dev/checkout/dist/platform/agent-cli-path.js",
    });
    expect(result).toBe(path.posix.join("/unrelated", "resources", "app", "bin"));
    expect(result).not.toBe(path.posix.join("/resources", "app", "bin"));
  });
});

describe("prependToPath", () => {
  it("prepends the new directory ahead of the existing PATH", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };
    prependToPath(env, "/opt/app/bin", "linux");
    expect(env.PATH).toBe("/opt/app/bin:/usr/bin:/bin");
  });

  it("is idempotent: does not add the directory twice", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/opt/app/bin:/usr/bin" };
    prependToPath(env, "/opt/app/bin", "linux");
    expect(env.PATH).toBe("/opt/app/bin:/usr/bin");
  });

  it("idempotency ignores a trailing slash", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/opt/app/bin/:/usr/bin" };
    prependToPath(env, "/opt/app/bin", "linux");
    expect(env.PATH).toBe("/opt/app/bin/:/usr/bin");
  });

  it("key matching is case-insensitive regardless of platform: a lowercase 'path' key is reused, not duplicated", () => {
    // Key-name matching is unconditionally case-insensitive (unlike value comparison,
    // which is platform-gated below) — the whole point is never creating a second,
    // conflicting PATH-ish key next to whatever's already there, on any OS.
    const env: NodeJS.ProcessEnv = { path: "/usr/bin" };
    prependToPath(env, "/opt/app/bin", "linux");
    expect(env.path).toBe("/opt/app/bin:/usr/bin");
    expect(env.PATH).toBeUndefined();
  });

  it("reuses Windows's real 'Path' key case-insensitively instead of adding a second PATH", () => {
    const env: NodeJS.ProcessEnv = { Path: "C:\\Windows\\system32" };
    prependToPath(env, "C:\\PenguinHarness\\bin", "win32");
    expect(env.Path).toBe("C:\\PenguinHarness\\bin;C:\\Windows\\system32");
    expect(env.PATH).toBeUndefined();
  });

  it("idempotency on win32 is case-insensitive (paths are case-insensitive there)", () => {
    const env: NodeJS.ProcessEnv = { Path: "C:\\PenguinHarness\\Bin;C:\\Windows" };
    prependToPath(env, "c:\\penguinharness\\bin", "win32");
    expect(env.Path).toBe("C:\\PenguinHarness\\Bin;C:\\Windows");
  });

  it("the same casing difference is NOT idempotent on POSIX (case-sensitive filesystem)", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/opt/App/bin:/usr/bin" };
    prependToPath(env, "/opt/app/bin", "linux");
    expect(env.PATH).toBe("/opt/app/bin:/opt/App/bin:/usr/bin");
  });

  it("handles an empty existing PATH", () => {
    const env: NodeJS.ProcessEnv = {};
    prependToPath(env, "/opt/app/bin", "linux");
    expect(env.PATH).toBe("/opt/app/bin");
  });

  it("leaves unrelated env keys untouched", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin", FOO: "bar" };
    prependToPath(env, "/opt/app/bin", "linux");
    expect(env.FOO).toBe("bar");
  });
});

describe("ensureCliOnPath", () => {
  it("does not modify the passed-in env object when no packaged layout can be found", () => {
    // The real process this test runs under (vitest/tsx, not a packaged app) has no
    // .../node_modules/@prismshadow/penguin-server layout at its argv[1]/execPath, so
    // findCliBinDir()'s real-deps default resolves to null and this is a true no-op.
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin", FOO: "bar" };
    const snapshot = { ...env };
    ensureCliOnPath(env);
    expect(env).toEqual(snapshot);
  });
});

describe("platform boot extends process.env.PATH (integration)", () => {
  let tmpAppDir: string | undefined;
  let originalArgv1: string | undefined;
  let originalPathValue: string | undefined;
  let pathKeyUsed: string | undefined;

  afterEach(async () => {
    // Always restore process.argv[1] and process.env, whether or not the test body
    // finished cleanly — this test mutates real global state other test files share.
    if (originalArgv1 !== undefined) process.argv[1] = originalArgv1;
    if (pathKeyUsed !== undefined) {
      if (originalPathValue === undefined) delete process.env[pathKeyUsed];
      else process.env[pathKeyUsed] = originalPathValue;
    }
    if (tmpAppDir !== undefined) {
      await fs.promises.rm(tmpAppDir, { recursive: true, force: true });
    }
  });

  it("a platform-touching route boots the packaged platform, which extends the real process.env.PATH", async () => {
    // Fake a packaged layout on disk: <tmpAppDir>/bin/<launcher> plus a
    // node_modules/@prismshadow/penguin-server/dist/index.js path (need not exist —
    // findCliBinDir only parses the string) that process.argv[1] is made to point at,
    // matching what packages/desktop's server-process.ts forks the real server with.
    tmpAppDir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-cli-path-test-"));
    const binDir = path.join(tmpAppDir, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    const launcherName = process.platform === "win32" ? "penguin.cmd" : "penguin";
    fs.writeFileSync(path.join(binDir, launcherName), "#!/bin/sh\necho penguin\n");

    originalArgv1 = process.argv[1];
    process.argv[1] = path.join(
      tmpAppDir,
      "node_modules",
      "@prismshadow",
      "penguin-server",
      "dist",
      "index.js",
    );

    // Snapshot whichever PATH-like key exists so it can be restored verbatim.
    pathKeyUsed = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
    originalPathValue = process.env[pathKeyUsed];

    const t = await createTestApp();
    try {
      const admin = await loginAdmin(t.app);
      const api = apiClient(t.app, admin.cookie);
      // Any platform-touching route triggers the lazy first boot (see hmr/host.ts).
      const info = await api.get("/api/hmr/platform");
      expect(info.status).toBe(200);

      const pathNow = process.env[pathKeyUsed] ?? "";
      const entries = pathNow.split(path.delimiter);
      expect(entries).toContain(binDir);
    } finally {
      await t.cleanup();
    }
  });
});
