import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  inspectSymlinkTarget,
  inspectWrapperTarget,
  isVolatileAppLocation,
  legacyOfferedFlagPath,
  readCliCommandState,
  stateFilePath,
  syncSymlink,
  syncWrapper,
  writeCliCommandState,
} from "../src/cli-link.js";
import { appImageWrapperScript, posixLauncherScript } from "../src/launcher.js";

/**
 * A real directory tree, not a mocked fs: the whole point of these functions is what they
 * do to symlinks, modes and dangling targets, none of which a mock would reproduce.
 */
let tmp: string;

/**
 * Tests whose assertion is a POSIX fact: the target a dangling symlink stores (Windows
 * rewrites it into a backslash path that no longer names the packaged layout), and the exec
 * bit, which Windows does not carry. Both belong to forms that only run on macOS and Linux.
 */
const itPosix = it.skipIf(process.platform === "win32");

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-cli-link-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A packaged app tree with the launcher the installers point at. */
function packApp(name: string): string {
  const appDir = path.join(tmp, name, "Contents", "Resources", "app");
  fs.mkdirSync(path.join(appDir, "bin"), { recursive: true });
  const launcher = path.join(appDir, "bin", "penguin");
  fs.writeFileSync(launcher, posixLauncherScript(), { mode: 0o755 });
  return launcher;
}

describe("syncSymlink (the macOS form)", () => {
  it("installs when nothing is there", () => {
    const desired = packApp("PenguinHarness.app");
    const link = path.join(tmp, "usr-local-bin", "penguin");

    expect(syncSymlink(link, desired, false)).toEqual({
      action: "installed",
      detail: `${link} does not exist`,
    });
    expect(fs.readlinkSync(link)).toBe(desired);
  });

  it("does nothing when it already points at this app", () => {
    const desired = packApp("PenguinHarness.app");
    const link = path.join(tmp, "bin", "penguin");
    syncSymlink(link, desired, false);
    const before = fs.lstatSync(link).mtimeMs;

    expect(syncSymlink(link, desired, false).action).toBe("current");
    expect(fs.lstatSync(link).mtimeMs).toBe(before);
  });

  itPosix("repairs a link left dangling by a moved or updated app", () => {
    // What a launch from the dmg used to leave behind, and what an app moved out of a
    // previous location leaves behind: the link is ours, and its target is gone.
    const link = path.join(tmp, "bin", "penguin");
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(
      "/Volumes/PenguinHarness/PenguinHarness.app/Contents/Resources/app/bin/penguin",
      link,
    );
    expect(fs.existsSync(link)).toBe(false); // dangling
    const desired = packApp("PenguinHarness.app");

    expect(syncSymlink(link, desired, false).action).toBe("installed");
    expect(fs.readlinkSync(link)).toBe(desired);
  });

  it("repairs a link pointing at an older install of this app", () => {
    const stale = packApp("Old.app");
    const link = path.join(tmp, "bin", "penguin");
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(stale, link);
    const desired = packApp("PenguinHarness.app");

    expect(syncSymlink(link, desired, false).action).toBe("installed");
    expect(fs.readlinkSync(link)).toBe(desired);
  });

  it("never replaces a penguin this app did not write", () => {
    const desired = packApp("PenguinHarness.app");
    const link = path.join(tmp, "bin", "penguin");
    fs.mkdirSync(path.dirname(link), { recursive: true });
    // A regular file: an npm global install, a Homebrew shim, the user's own script.
    fs.writeFileSync(link, "#!/bin/sh\necho not ours\n", { mode: 0o755 });

    const result = syncSymlink(link, desired, false);
    expect(result.action).toBe("skipped");
    expect(result.detail).toContain("not a symlink this app wrote");
    expect(fs.readFileSync(link, "utf8")).toBe("#!/bin/sh\necho not ours\n");
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(false);
  });

  it("never follows a foreign symlink either", () => {
    const desired = packApp("PenguinHarness.app");
    const theirs = path.join(tmp, "dot-penguin", "bin", "penguin");
    fs.mkdirSync(path.dirname(theirs), { recursive: true });
    fs.writeFileSync(theirs, "#!/bin/sh\necho tarball\n", { mode: 0o755 });
    const link = path.join(tmp, "bin", "penguin");
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(theirs, link);

    expect(syncSymlink(link, desired, false).action).toBe("skipped");
    expect(fs.readlinkSync(link)).toBe(theirs);
  });

  it("replaces a foreign command only when forced, which only the menu item does", () => {
    const desired = packApp("PenguinHarness.app");
    const link = path.join(tmp, "bin", "penguin");
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.writeFileSync(link, "#!/bin/sh\necho not ours\n", { mode: 0o755 });

    expect(syncSymlink(link, desired, true).action).toBe("installed");
    expect(fs.readlinkSync(link)).toBe(desired);
  });
});

describe("syncWrapper (the Linux AppImage form)", () => {
  const script = appImageWrapperScript("/home/u/Apps/penguin-desktop-linux-x86_64.AppImage");

  it("installs a wrapper when nothing is there", () => {
    const target = path.join(tmp, "local-bin", "penguin");

    expect(syncWrapper(target, script, false).action).toBe("installed");
    expect(fs.readFileSync(target, "utf8")).toBe(script);
    // Written through a temporary file; it must not be left behind.
    expect(fs.existsSync(`${target}.tmp`)).toBe(false);
  });

  itPosix("installs it executable, or nothing on PATH can run it", () => {
    const target = path.join(tmp, "local-bin", "penguin");
    syncWrapper(target, script, false);

    expect(fs.statSync(target).mode & 0o111).not.toBe(0);
  });

  it("does nothing when the wrapper already runs this AppImage", () => {
    const target = path.join(tmp, "local-bin", "penguin");
    syncWrapper(target, script, false);

    expect(syncWrapper(target, script, false).action).toBe("current");
  });

  it("rewrites its own wrapper when the AppImage moved", () => {
    const target = path.join(tmp, "local-bin", "penguin");
    syncWrapper(target, appImageWrapperScript("/old/path.AppImage"), false);

    expect(syncWrapper(target, script, false).action).toBe("installed");
    expect(fs.readFileSync(target, "utf8")).toBe(script);
  });

  it("never replaces the symlink install.sh puts at this exact path", () => {
    // install.sh does `ln -sf ~/.penguin/bin/penguin ~/.local/bin/penguin`, unconditionally,
    // at the very path this form uses. Ours is the side that has to give way.
    const theirs = path.join(tmp, "dot-penguin", "bin", "penguin");
    fs.mkdirSync(path.dirname(theirs), { recursive: true });
    fs.writeFileSync(theirs, "#!/bin/sh\necho tarball\n", { mode: 0o755 });
    const target = path.join(tmp, "local-bin", "penguin");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(theirs, target);

    const result = syncWrapper(target, script, false);
    expect(result.action).toBe("skipped");
    expect(result.detail).toContain("which this app did not write");
    expect(fs.readlinkSync(target)).toBe(theirs);
  });

  it("never replaces a foreign regular file", () => {
    const target = path.join(tmp, "local-bin", "penguin");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "#!/usr/bin/env node\n// somebody else's penguin\n", { mode: 0o755 });

    expect(syncWrapper(target, script, false).action).toBe("skipped");
    expect(fs.readFileSync(target, "utf8")).toContain("somebody else's penguin");
  });

  it("does not read a large binary sitting at the target", () => {
    const target = path.join(tmp, "local-bin", "penguin");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // The marker sits past the size cap on purpose: what makes this foreign has to be the
    // refusal to read the file, not the absence of the text.
    fs.writeFileSync(target, Buffer.concat([Buffer.alloc(128 * 1024, 7), Buffer.from(script)]));

    expect(syncWrapper(target, script, false).action).toBe("skipped");
    expect(fs.statSync(target).size).toBe(128 * 1024 + Buffer.byteLength(script));
  });
});

describe("inspect helpers", () => {
  it("recognises a launcher from an older release by its marker", () => {
    // The marker text has shipped unchanged since 0.2.2, which is what lets an install made
    // by an older version be repaired rather than treated as somebody else's command.
    const target = path.join(tmp, "penguin");
    fs.writeFileSync(target, posixLauncherScript());
    expect(inspectWrapperTarget(target, "different script").kind).toBe("ours");
  });

  it("reports an unreadable target as foreign rather than guessing", () => {
    const dir = path.join(tmp, "penguin");
    fs.mkdirSync(dir);
    expect(inspectSymlinkTarget(dir, "/x/bin/penguin").kind).toBe("foreign");
    expect(inspectWrapperTarget(dir, "script").kind).toBe("foreign");
  });
});

describe("isVolatileAppLocation", () => {
  it("refuses to install from a mounted dmg", () => {
    expect(
      isVolatileAppLocation(
        "/Volumes/PenguinHarness/PenguinHarness.app/Contents/Resources/app",
        "darwin",
      ),
    ).toBe(true);
  });

  it("refuses to install from a translocated bundle", () => {
    // Gatekeeper runs a quarantined bundle from a read-only copy under a random path; a
    // link into it dies with the session.
    expect(
      isVolatileAppLocation(
        "/private/var/folders/x/AppTranslocation/1B2C/d/PenguinHarness.app/Contents/Resources/app",
        "darwin",
      ),
    ).toBe(true);
  });

  it("installs normally from Applications", () => {
    expect(
      isVolatileAppLocation("/Applications/PenguinHarness.app/Contents/Resources/app", "darwin"),
    ).toBe(false);
  });

  it("is a macOS rule only", () => {
    expect(isVolatileAppLocation("/Volumes/whatever/app", "linux")).toBe(false);
    expect(isVolatileAppLocation("/Volumes/whatever/app", "win32")).toBe(false);
  });
});

describe("recorded state", () => {
  it("remembers a declined administrator prompt", () => {
    writeCliCommandState(tmp, { version: 1, decision: "declined", lastResult: "failed" });
    expect(readCliCommandState(tmp).decision).toBe("declined");
  });

  it("treats every other outcome as no decision, so the next launch retries", () => {
    for (const lastResult of ["foreign", "deferred", "failed"] as const) {
      writeCliCommandState(tmp, { version: 1, lastResult });
      expect(readCliCommandState(tmp).decision).toBeUndefined();
    }
  });

  it("reads a missing or corrupt file as no decision rather than a decline", () => {
    expect(readCliCommandState(tmp).decision).toBeUndefined();
    fs.writeFileSync(stateFilePath(tmp), "{ not json");
    expect(readCliCommandState(tmp).decision).toBeUndefined();
    fs.writeFileSync(stateFilePath(tmp), JSON.stringify({ decision: "whatever" }));
    expect(readCliCommandState(tmp).decision).toBeUndefined();
  });

  it("removes the pre-0.2.7 marker, which recorded the question and not the answer", () => {
    const legacy = legacyOfferedFlagPath(tmp);
    fs.writeFileSync(legacy, "2026-08-06T00:00:00.000Z\n");
    writeCliCommandState(tmp, { version: 1, lastResult: "installed" });
    expect(fs.existsSync(legacy)).toBe(false);
  });

  it("survives an unwritable state directory", () => {
    const nested = path.join(tmp, "file-in-the-way", "userData");
    fs.writeFileSync(path.join(tmp, "file-in-the-way"), "");
    expect(() =>
      writeCliCommandState(nested, { version: 1, lastResult: "installed" }),
    ).not.toThrow();
    expect(readCliCommandState(nested).decision).toBeUndefined();
  });
});
