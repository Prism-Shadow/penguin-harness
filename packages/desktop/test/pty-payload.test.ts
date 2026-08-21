import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  NODE_PTY_RELDIR,
  hostBinding,
  nativeBindings,
  shipsNodePtyFile,
  stageNodePty,
} from "../src/pty-payload.js";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A node-pty install with one of everything its npm tarball and node-gyp actually produce. */
function fakeNodePty(root: string): void {
  const write = (rel: string, mode?: number) => {
    const file = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, rel);
    if (mode !== undefined) fs.chmodSync(file, mode);
  };
  write("package.json");
  write("LICENSE");
  write("README.md");
  write("binding.gyp");
  write("lib/index.js");
  write("lib/index.js.map");
  write("lib/unixTerminal.test.js");
  write("lib/worker/conoutSocketWorker.js");
  write("build/Release/pty.node");
  write("build/Release/spawn-helper", 0o644);
  write("build/Debug/pty.node");
  write("prebuilds/darwin-arm64/pty.node");
  write("prebuilds/darwin-arm64/spawn-helper", 0o644);
  write("prebuilds/win32-x64/pty.node");
  write("prebuilds/win32-x64/pty.pdb");
  write("prebuilds/win32-x64/winpty.lib");
  write("prebuilds/win32-x64/conpty/OpenConsole.exe");
  write("src/unixTerminal.ts");
  write("deps/winpty/LICENSE");
  write("deps/winpty/README.md");
  write("scripts/post-install.js");
  write("third_party/notice.txt");
  write("typings/node-pty.d.ts");
}

describe("shipsNodePtyFile", () => {
  it("keeps the manifest the require lands on, both licenses, the JavaScript and the binaries", () => {
    for (const rel of [
      "package.json",
      "LICENSE",
      "lib/index.js",
      "lib/worker/conoutSocketWorker.js",
      "build/Release/pty.node",
      "build/Release/spawn-helper",
      "prebuilds/darwin-arm64/pty.node",
      "prebuilds/win32-x64/conpty/OpenConsole.exe",
      "deps/winpty/LICENSE",
    ]) {
      expect(shipsNodePtyFile(rel), rel).toBe(true);
    }
  });

  it("drops build inputs, sourcemaps, node-pty's own tests and Windows debug symbols", () => {
    for (const rel of [
      "README.md",
      "binding.gyp",
      "lib/index.js.map",
      "lib/unixTerminal.test.js",
      "prebuilds/win32-x64/pty.pdb",
      "prebuilds/win32-x64/winpty.lib",
      "src/unixTerminal.ts",
      "deps/winpty/README.md",
      "scripts/post-install.js",
      "third_party/notice.txt",
      "typings/node-pty.d.ts",
    ]) {
      expect(shipsNodePtyFile(rel), rel).toBe(false);
    }
  });
});

describe("stageNodePty", () => {
  const tmps: string[] = [];
  const tmpdir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-pty-payload-"));
    tmps.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of tmps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("copies exactly the shipping subset, keeping node-pty's package-relative layout", () => {
    const src = tmpdir();
    const dest = path.join(tmpdir(), "node-pty");
    fakeNodePty(src);

    const copied = stageNodePty(src, dest).sort();

    expect(copied).toEqual([
      "LICENSE",
      "build/Release/pty.node",
      "build/Release/spawn-helper",
      "deps/winpty/LICENSE",
      "lib/index.js",
      "lib/worker/conoutSocketWorker.js",
      "package.json",
      "prebuilds/darwin-arm64/pty.node",
      "prebuilds/darwin-arm64/spawn-helper",
      "prebuilds/win32-x64/conpty/OpenConsole.exe",
      "prebuilds/win32-x64/pty.node",
    ]);
    for (const rel of copied) {
      expect(fs.existsSync(path.join(dest, ...rel.split("/"))), rel).toBe(true);
    }
    expect(fs.existsSync(path.join(dest, "src"))).toBe(false);
    expect(fs.existsSync(path.join(dest, "deps", "winpty", "README.md"))).toBe(false);
    expect(fs.existsSync(path.join(dest, "build", "Debug"))).toBe(false);
  });

  it("restores the exec bit node-pty's tarball leaves off spawn-helper", () => {
    const src = tmpdir();
    const dest = path.join(tmpdir(), "node-pty");
    fakeNodePty(src);

    stageNodePty(src, dest);

    for (const rel of ["build/Release/spawn-helper", "prebuilds/darwin-arm64/spawn-helper"]) {
      const mode = fs.statSync(path.join(dest, ...rel.split("/"))).mode;
      expect(mode & 0o111, rel).not.toBe(0);
    }
  });

  it("replaces a previous staging instead of merging into it", () => {
    const src = tmpdir();
    const dest = path.join(tmpdir(), "node-pty");
    fakeNodePty(src);
    fs.mkdirSync(path.join(dest, "prebuilds", "linux-x64"), { recursive: true });
    fs.writeFileSync(path.join(dest, "prebuilds", "linux-x64", "pty.node"), "stale");

    stageNodePty(src, dest);

    expect(fs.existsSync(path.join(dest, "prebuilds", "linux-x64"))).toBe(false);
  });

  it("reports the native bindings, so a copy that ships no pty fails the build", () => {
    const src = tmpdir();
    const dest = path.join(tmpdir(), "node-pty");
    fakeNodePty(src);

    expect(nativeBindings(stageNodePty(src, dest)).sort()).toEqual([
      "build/Release/pty.node",
      "prebuilds/darwin-arm64/pty.node",
      "prebuilds/win32-x64/pty.node",
    ]);
    expect(nativeBindings(["package.json", "lib/index.js"])).toEqual([]);
  });
});

describe("hostBinding", () => {
  const staged = [
    "build/Release/pty.node",
    "prebuilds/darwin-arm64/pty.node",
    "prebuilds/win32-x64/pty.node",
  ];

  it("prefers the node-gyp build, then the platform prebuild — node-pty's own order", () => {
    expect(hostBinding(staged, "linux", "x64")).toBe("build/Release/pty.node");
    expect(hostBinding(staged.slice(1), "darwin", "arm64")).toBe("prebuilds/darwin-arm64/pty.node");
    expect(hostBinding(staged.slice(1), "win32", "x64")).toBe("prebuilds/win32-x64/pty.node");
  });

  it("rejects a copy carrying only other platforms' bindings, which the count alone accepts", () => {
    const prebuiltOnly = staged.slice(1);

    expect(nativeBindings(prebuiltOnly)).toHaveLength(2);
    expect(hostBinding(prebuiltOnly, "linux", "x64")).toBeUndefined();
    expect(hostBinding(prebuiltOnly, "darwin", "x64")).toBeUndefined();
  });
});

describe("packaged layout", () => {
  it("stages into the first node_modules above the server bundle", () => {
    expect(NODE_PTY_RELDIR).toEqual(["dist", "node_modules", "node-pty"]);
  });

  it("is listed in electron-builder's files, which otherwise excludes every node_modules", () => {
    const builderConfig = fs.readFileSync(path.join(pkgDir, "electron-builder.yml"), "utf8");
    expect(builderConfig).toContain("- dist/node_modules/**/*");
  });
});
