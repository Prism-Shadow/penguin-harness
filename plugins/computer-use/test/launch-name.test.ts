/**
 * What `launch` accepts, before agent-desktop sees the name.
 *
 * - Given a path, a script, a bundle given by name, an option or a home-relative name, it is
 *   refused on every system; a `.exe` name is a program name on Windows only.
 * - Given Linux, a name is an installed app's only when a desktop entry in a system applications
 *   directory has it as its id, its command or its Name; agent-desktop is then handed that entry's
 *   file. An entry that is hidden, not an application or runs in a terminal is not offered, a
 *   directory the user can write is not looked in, and the first directory holding an id wins.
 * - Given a directory the current user owns, it is not the system's; /usr/share is.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { launchNameFault, linuxDesktopEntry, resolveLaunch, rootOnly } from "../src/launch-name.js";
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
  it("is found by its id, its command or its Name, ignoring case", async () => {
    const apps = await desktopEntries([
      { id: "org.gnome.Calculator", name: "Calculator", exec: "gnome-calculator %U" },
      { id: "editor", name: "Text Editor", exec: "env GTK_DEBUG=0 /usr/bin/gnome-text-editor" },
    ]);
    const calc = path.join(apps.dir, "applications", "org.gnome.Calculator.desktop");
    for (const name of [
      "org.gnome.Calculator",
      "org.gnome.calculator.desktop",
      "gnome-calculator",
      "calculator",
    ]) {
      expect(await linuxDesktopEntry(name, apps.dataDirs, apps.trusted), name).toBe(calc);
    }
    expect(await linuxDesktopEntry("gnome-text-editor", apps.dataDirs, apps.trusted)).toBe(
      path.join(apps.dir, "applications", "editor.desktop"),
    );
    expect(await resolveLaunch("Text Editor", { platform: "linux", ...apps })).toEqual({
      ok: true,
      app: path.join(apps.dir, "applications", "editor.desktop"),
    });
  });

  it("offers no hidden, non-application or terminal entry", async () => {
    const apps = await desktopEntries([
      { id: "hidden", name: "Hidden", exec: "hidden", extra: "Hidden=true\n" },
      { id: "term", name: "Term", exec: "htop", extra: "Terminal=true\n" },
    ]);
    await fs.writeFile(
      path.join(apps.dir, "applications", "link.desktop"),
      "[Desktop Entry]\nType=Link\nName=Link\nURL=https://example.invalid\n",
    );
    for (const name of ["hidden", "htop", "Link"]) {
      expect(await linuxDesktopEntry(name, apps.dataDirs, apps.trusted), name).toBeNull();
    }
  });

  it("does not look in a directory the user can write, and the first directory's id wins", async () => {
    const mine = await desktopEntries([{ id: "calc", name: "Calc", exec: "/home/me/payload" }]);
    const system = await desktopEntries([{ id: "calc", name: "Calc", exec: "gnome-calculator" }]);
    const onlySystem = async (file: string) => file.startsWith(system.dir);
    expect(await linuxDesktopEntry("calc", [mine.dir, system.dir], onlySystem)).toBe(
      path.join(system.dir, "applications", "calc.desktop"),
    );
    const both = async () => true;
    expect(await linuxDesktopEntry("calc", [mine.dir, system.dir], both)).toBe(
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

  it.skipIf(!posixUser)("a directory the current user owns is not the system's", async () => {
    expect(await rootOnly(await tempDir())).toBe(false);
  });

  it.skipIf(process.platform !== "linux")("/usr/share is the system's", async () => {
    expect(await rootOnly("/usr/share")).toBe(true);
  });
});
