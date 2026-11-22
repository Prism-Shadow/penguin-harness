/**
 * What `launch` accepts, before agent-desktop sees the name.
 *
 * - Given a path, a script, a bundle given by name, an option or a home-relative name, it is
 *   refused on every system; a `.exe` name is a program name on Windows only.
 * - Given Linux, a name is an installed app's only when a desktop entry in a system applications
 *   directory has it as its id, its Name, or its command when exactly one entry runs that command
 *   and it is no shell or interpreter; agent-desktop is then handed that entry's file and a PATH
 *   of system directories only. An entry that is hidden, not an application, runs in a terminal
 *   or is a terminal emulator is not offered, a directory the user can write is not looked in,
 *   the first directory holding an id wins, and an entry whose program resolves only in a
 *   directory the user can write is not launched.
 * - Given a directory the current user owns, it is not the system's; /usr/share is, on a machine
 *   where this user cannot write it.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { accessSync, constants } from "node:fs";
import {
  launchNameFault,
  linuxDesktopEntry,
  resolveLaunch,
  systemOnly,
} from "../src/launch-name.js";
import { desktopEntries, tempDir } from "./helpers.js";

describe("a name that is not an app's", () => {
  it.each([
    "/tmp/payload.sh",
    "bin/payload",
    "C:\\Users\\me\\x.exe",
    "c:x",
    "~/bin/x",
    "./x",
    "..",
    "-x",
    "payload.sh",
    "Evil.app",
    "entry.desktop",
    "run.ps1",
    "go.bat",
    "go.cmd",
    "go.command",
    "",
    "a\u0000b",
  ])("%j is refused on every system", (app) => {
    for (const platform of ["linux", "darwin", "win32"] as const) {
      expect(launchNameFault(app, platform), platform).not.toBeNull();
    }
  });

  it("a .exe name is a program on Windows, a file elsewhere", () => {
    expect(launchNameFault("notepad.exe", "win32")).toBeNull();
    expect(launchNameFault("notepad.exe", "linux")).toMatch(/names a file/);
    expect(launchNameFault("Calculator", "darwin")).toBeNull();
  });
});

describe("Linux: an installed app's desktop entry", () => {
  it("is found by its id, its Name, or its command, ignoring case", async () => {
    const apps = await desktopEntries(
      [
        { id: "org.gnome.Calculator", name: "Calculator", exec: "gnome-calculator %U" },
        { id: "editor", name: "Text Editor", exec: "env GTK_DEBUG=0 gnome-text-editor" },
      ],
      ["gnome-text-editor"],
    );
    const find = (name: string) =>
      linuxDesktopEntry(name, apps.dataDirs, apps.trusted, apps.pathDirs);
    const calc = path.join(apps.dir, "applications", "org.gnome.Calculator.desktop");
    for (const name of [
      "org.gnome.Calculator",
      "org.gnome.calculator.desktop",
      "gnome-calculator",
      "calculator",
    ]) {
      expect(await find(name), name).toBe(calc);
    }
    expect(await find("gnome-text-editor")).toBe(
      path.join(apps.dir, "applications", "editor.desktop"),
    );
    expect(await resolveLaunch("Text Editor", { platform: "linux", ...apps })).toEqual({
      ok: true,
      app: path.join(apps.dir, "applications", "editor.desktop"),
      path: apps.bin,
    });
  });

  it("offers no hidden, non-application, terminal or terminal-emulator entry", async () => {
    const apps = await desktopEntries([
      { id: "hidden", name: "Hidden", exec: "hidden", extra: "Hidden=true\n" },
      { id: "term", name: "Term", exec: "htop", extra: "Terminal=true\n" },
      { id: "xterm", name: "XTerm", exec: "xterm", extra: "Categories=System;TerminalEmulator;\n" },
      { id: "vterm", name: "Vendor Term", exec: "vterm", extra: "Categories=X-Vendor-Terminal;\n" },
    ]);
    await fs.writeFile(
      path.join(apps.dir, "applications", "link.desktop"),
      "[Desktop Entry]\nType=Link\nName=Link\nURL=https://example.invalid\n",
    );
    for (const name of ["hidden", "htop", "Link", "xterm", "XTerm", "Vendor Term"]) {
      expect(
        await linuxDesktopEntry(name, apps.dataDirs, apps.trusted, apps.pathDirs),
        name,
      ).toBeNull();
    }
  });

  it("matches a command only when one entry alone runs it, and never a shell's", async () => {
    const apps = await desktopEntries([
      { id: "fortune", name: "Fortune", exec: 'sh -c "fortune | xmessage -file -"' },
      { id: "notes-a", name: "Notes A", exec: "notes --a" },
      { id: "notes-b", name: "Notes B", exec: "notes --b" },
      { id: "calc", name: "Calc", exec: "calcapp" },
    ]);
    const find = (name: string) =>
      linuxDesktopEntry(name, apps.dataDirs, apps.trusted, apps.pathDirs);
    expect(await find("sh")).toBeNull();
    expect(await find("notes")).toBeNull();
    expect(await find("calcapp")).toBe(path.join(apps.dir, "applications", "calc.desktop"));
    expect(await find("Fortune")).toBe(path.join(apps.dir, "applications", "fortune.desktop"));
  });

  it("launches nothing whose program resolves only in a directory the user can write", async () => {
    const apps = await desktopEntries([{ id: "calc", name: "Calc", exec: "gnome-calculator" }]);
    const planted = await tempDir();
    await fs.writeFile(path.join(planted, "gnome-calculator"), "#!/bin/sh\n", { mode: 0o755 });
    const systemOnlyBin = async (file: string) => !file.startsWith(planted);
    // The planted directory comes first on PATH: it is left out, and the system one resolves it.
    expect(
      await resolveLaunch("calc", {
        platform: "linux",
        dataDirs: apps.dataDirs,
        pathDirs: [planted, apps.bin],
        trusted: systemOnlyBin,
      }),
    ).toEqual({
      ok: true,
      app: path.join(apps.dir, "applications", "calc.desktop"),
      path: apps.bin,
    });
    // With the program only in the planted directory, there is nothing to launch.
    await fs.rm(path.join(apps.bin, "gnome-calculator"));
    expect(
      await resolveLaunch("calc", {
        platform: "linux",
        dataDirs: apps.dataDirs,
        pathDirs: [planted, apps.bin],
        trusted: systemOnlyBin,
      }),
    ).toMatchObject({ ok: false });
  });

  it("does not look in a directory the user can write, and the first directory's id wins", async () => {
    const mine = await desktopEntries([{ id: "calc", name: "Calc", exec: "mine-calc" }]);
    const system = await desktopEntries([{ id: "calc", name: "Calc", exec: "gnome-calculator" }]);
    const bins = [mine.bin, system.bin];
    const onlySystem = async (file: string) => file.startsWith(system.dir);
    expect(await linuxDesktopEntry("calc", [mine.dir, system.dir], onlySystem, bins)).toBe(
      path.join(system.dir, "applications", "calc.desktop"),
    );
    const both = async () => true;
    expect(await linuxDesktopEntry("calc", [mine.dir, system.dir], both, bins)).toBe(
      path.join(mine.dir, "applications", "calc.desktop"),
    );
  });

  it("refuses a name no entry has, saying what Linux takes", async () => {
    const apps = await desktopEntries([]);
    expect(await resolveLaunch("payload", { platform: "linux", ...apps })).toMatchObject({
      ok: false,
      message: expect.stringMatching(
        /^no installed app is named "payload": on Linux, launch takes/,
      ),
    });
  });
});

describe("whose directory it is", () => {
  const posixUser = process.platform !== "win32" && process.getuid?.() !== 0;
  /** Whether this user can write any of /, /usr and /usr/share (some CI images let it). */
  const usrWritable = ["/", "/usr", "/usr/share"].some((d) => {
    try {
      accessSync(d, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  });

  it.skipIf(!posixUser)("a directory the current user owns is not the system's", async () => {
    expect(await systemOnly(await tempDir())).toBe(false);
  });

  it.skipIf(process.platform !== "linux" || !posixUser || usrWritable)(
    "/usr/share is the system's",
    async () => {
      expect(await systemOnly("/usr/share")).toBe(true);
    },
  );
});
